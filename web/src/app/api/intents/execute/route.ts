import { baseDecode } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { events } from "@/lib/near";
import { cleanGuestName, setGuestName } from "@/lib/guestNames";

// Submits a guest's signed intent to intents.near; the relayer pays the gas.
// Only two shapes are relayed: a registration (one `ft_withdraw` of USDC to the
// escrow with a register message) and a cash-out (one USDC `transfer` inside
// NEAR Intents). The verifier checks the signature again on-chain.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
  let signed: { standard: string; payload: string; signature: string; name?: unknown };
  let signer: string;
  let nonce: string;
  let registration: { eventId: number; amount: string } | undefined;
  try {
    signed = await req.json();
    if (signed.standard !== "erc191" || typeof signed.payload !== "string" || signed.payload.length > 4096
      || typeof signed.signature !== "string" || !/^secp256k1:[1-9A-HJ-NP-Za-km-z]{80,92}$/.test(signed.signature)) throw new Error();
    const payload = JSON.parse(signed.payload);
    signer = payload.signer_id;
    const deadline = Date.parse(payload.deadline);
    if (!/^0x[0-9a-f]{40}$/.test(signer) || payload.verifying_contract !== INTENTS_CONTRACT
      || !Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 10 * 60_000
      || typeof payload.nonce !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(payload.nonce)
      || !Array.isArray(payload.intents) || payload.intents.length !== 1) throw new Error();

    nonce = payload.nonce;
    const [intent] = payload.intents;
    const positiveAmount = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,38}$/.test(value)
      && BigInt(value) < (1n << 128n);
    if (intent.intent === "ft_withdraw") {
      const msg = JSON.parse(intent.msg);
      if (intent.token !== USDC_CONTRACT || intent.receiver_id !== EVENTS_CONTRACT || !positiveAmount(intent.amount)
        || msg.action !== "register" || msg.guest !== signer || !Number.isSafeInteger(msg.event_id) || msg.event_id < 0) throw new Error();
      registration = { eventId: msg.event_id, amount: intent.amount };
    } else if (intent.intent !== "transfer" || typeof intent.receiver_id !== "string"
      || intent.receiver_id.length > 64 || !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(intent.receiver_id)
      || Object.keys(intent.tokens).join() !== `nep141:${USDC_CONTRACT}`
      || !positiveAmount(intent.tokens[`nep141:${USDC_CONTRACT}`])) throw new Error();

    const bytes = Buffer.from(signed.payload, "utf8");
    const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
    const signature = baseDecode(signed.signature.slice("secp256k1:".length));
    if (signature.length !== 65 || signature[64] > 1) throw new Error();
    const key = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
      .addRecoveryBit(signature[64]).recoverPublicKey(digest).toBytes(false);
    const recovered = Buffer.from(keccak_256(key.subarray(1)).subarray(12)).toString("hex");
    if (`0x${recovered}` !== signer) throw new Error();
  } catch {
    return Response.json({ error: "Invalid Nearvent intent or signature" }, { status: 400 });
  }

  try {
    if (registration) {
      const event = await events.get(registration.eventId);
      const existing = await events.guestStatus(registration.eventId, signer);
      if (!event || event.status !== "Open" || event.guest_count >= event.capacity || existing || event.deposit !== registration.amount) {
        return Response.json({ error: "This registration is unavailable. Your USDC is still in NEAR Intents." }, { status: 409 });
      }
    }
    if (await paidRequestLimited(req, "execute", signer, nonce)) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
    const outcome = await relayer().callFunctionRaw({
      contractId: INTENTS_CONTRACT,
      methodName: "execute_intents",
      args: { signed: [signed] },
      gas: 300_000_000_000_000n,
      waitUntil: "FINAL",
    });
    const status = outcome.status as { Failure?: unknown };
    if (status.Failure) return Response.json({ error: "Intent rejected", detail: status.Failure }, { status: 502 });
    // EVM guests have no staff token; the registration they just signed is their proof for the display name.
    const name = registration && cleanGuestName(signed.name);
    if (name) await setGuestName(registration!.eventId, signer, name).catch(() => {});
    return Response.json({ hash: outcome.transaction.hash });
  } catch {
    return Response.json({ error: "Intent status unavailable. Check your event or Intents balance before retrying." }, { status: 502 });
  }
}
