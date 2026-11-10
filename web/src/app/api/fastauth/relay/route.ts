import { createHash, createPublicKey, verify } from "node:crypto";
import { actions, Signature } from "near-api-js";
import { USDC_CONTRACT } from "@/lib/config";
import { view } from "@/lib/near";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { relayer } from "@/lib/relayer";
import { decodePayload, relayAllowed } from "@/lib/relayPolicy";
import { CONTRACTS, FREE_TIER_ERROR, relayRefusal } from "@/lib/relayServer";

const MAX_GAS = 300_000_000_000_000n;
const USDC_STORAGE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR
const IMPLICIT = /^[0-9a-f]{64}$/;
// DER header of an Ed25519 public key, so node:crypto can read the raw 32 bytes.
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

// Mainnet meta-transactions (NEP-366) for Google/email accounts, which hold no NEAR:
// the account signs a delegate action and the relayer sends it. The relayer pays the gas
// and also every deposit inside it, so only 1 yoctoNEAR deposits pass: a bigger one would
// let anyone move the relayer's NEAR (e.g. an overpaid create_event refunds the host).
// Only calls to our own contracts pass; the chain checks the nonce and access key again.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const body = await req.json().catch(() => null);
  if (typeof body?.storageFor === "string") return registerUsdc(req, body.storageFor);

  const bytes = typeof body?.delegate === "string" && body.delegate.length <= 12_000 ? Buffer.from(body.delegate, "base64") : null;
  const signature = typeof body?.signature === "string" ? Buffer.from(body.signature, "base64") : null;
  const p = bytes && decodePayload(bytes);
  if (!bytes || !p?.delegate || signature?.length !== 64 || !relayAllowed(p, CONTRACTS)
    // Google/email accounts are implicit: the account id is its own public key in hex.
    || !IMPLICIT.test(p.signerId) || Buffer.from(p.delegate.publicKey).toString("hex") !== p.signerId
    || p.calls.some((call) => call.deposit > 1n) || p.calls.reduce((gas, call) => gas + call.gas, 0n) > MAX_GAS) {
    return Response.json({ error: "Only Nearvent transactions are relayed" }, { status: 400 });
  }
  // Checked here too, so a bad signature never costs the relayer gas.
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, p.delegate.publicKey]), format: "der", type: "spki" });
  if (!verify(null, createHash("sha256").update(bytes).digest(), key, signature)) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  try {
    const refusal = await relayRefusal(p);
    if (refusal === FREE_TIER_ERROR) {
      return Response.json({ error: "Google and email accounts can create free events only: up to 50 seats, 2 in 30 days, ending within 60 days." }, { status: 400 });
    }
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not check the event's storage cost" }, { status: 502 });
  }
  if (await paidRequestLimited(req, "relay", p.signerId, p.delegate.nonce.toString())) {
    return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
  }
  try {
    const outcome = await relayer().signAndSendTransaction({
      receiverId: p.signerId,
      actions: [actions.signedDelegate({
        delegateAction: p.delegate.action as never,
        signature: new Signature({ keyType: 0, data: new Uint8Array(signature) }),
      })],
      throwOnFailure: false,
    });
    // The relayer's own transaction succeeds even when the inner call fails; look at every receipt.
    const failed = "Failure" in (outcome.status as object)
      || outcome.receipts_outcome.some((r) => "Failure" in (r.outcome.status as object));
    if (failed) return Response.json({ hash: outcome.transaction.hash, error: "Transaction failed" }, { status: 502 });
    return Response.json({ hash: outcome.transaction.hash });
  } catch {
    return Response.json({ error: "Transaction status unavailable. Check your balance before retrying." }, { status: 502 });
  }
}

// A USDC storage registration (e.g. a 1Click deposit address before a cash-out) costs
// 0.00125 NEAR that a Google/email account does not have; the relayer pays it.
async function registerUsdc(req: Request, account: string) {
  if (!IMPLICIT.test(account)) return Response.json({ error: "Expected an implicit account id" }, { status: 400 });
  try {
    if (await view("storage_balance_of", { account_id: account }, USDC_CONTRACT)) return Response.json({ registered: true });
    if (await paidRequestLimited(req, "storage", account)) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
    await relayer().callFunction({
      contractId: USDC_CONTRACT,
      methodName: "storage_deposit",
      args: { account_id: account, registration_only: true },
      deposit: USDC_STORAGE,
      gas: 30_000_000_000_000n,
    });
    return Response.json({ registered: true });
  } catch {
    return Response.json({ error: "Could not register USDC storage. Try again." }, { status: 502 });
  }
}
