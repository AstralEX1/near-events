import { baseDecode } from "near-api-js";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { events, hostBondFor, MAX_CAPACITY, needsBond, registrationEndsAt, view } from "@/lib/near";
import { cleanGuestName, setGuestName } from "@/lib/guestNames";
import { erc191Signer } from "@/lib/erc191";

// Submits a signed intent to intents.near; the relayer pays the gas.
// Only these shapes are relayed: a payment to the escrow (one `ft_withdraw` of
// USDC with a register, host_bond or dispute message), a cash-out (one USDC
// `transfer` inside NEAR Intents), and a host action (one `auth_call` to the
// escrow: create, finalize or cancel an event, no NEAR attached). The verifier
// checks the signature again on-chain.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
  let signed: { standard: string; payload: string; signature: string; name?: unknown };
  let signer: string;
  let nonce: string;
  let registration: { eventId: number; amount: string } | undefined;
  let bond: { eventId: number; amount: string } | undefined;
  let dispute: { eventId: number; amount: string; target: string; attended: boolean } | undefined;
  let hostAction: { create: { capacity: number; endsAt: number } } | { eventId: number; finalize: boolean } | undefined;
  let transfer: string | undefined;
  try {
    signed = await req.json();
    if (signed.standard !== "erc191" || typeof signed.payload !== "string" || signed.payload.length > 24_576
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
    // Only the fields we check reach the verifier (no notifications or extra calls paid by the relayer).
    const allowed: Record<string, string[]> = {
      ft_withdraw: ["intent", "token", "receiver_id", "amount", "msg", "memo"],
      auth_call: ["intent", "contract_id", "msg"],
      transfer: ["intent", "receiver_id", "tokens", "memo"],
    };
    if (!allowed[intent?.intent] || Object.keys(intent).some((k) => !allowed[intent.intent].includes(k))) throw new Error();
    const positiveAmount = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,38}$/.test(value)
      && BigInt(value) < (1n << 128n);
    if (intent.intent === "ft_withdraw") {
      const msg = JSON.parse(intent.msg);
      if (intent.token !== USDC_CONTRACT || intent.receiver_id !== EVENTS_CONTRACT || !positiveAmount(intent.amount)
        || !Number.isSafeInteger(msg.event_id) || msg.event_id < 0) throw new Error();
      const payment = { eventId: msg.event_id, amount: intent.amount };
      if (msg.action === "register" && msg.guest === signer) registration = payment;
      else if (msg.action === "host_bond" && Object.keys(msg).length === 2) bond = payment;
      else if (msg.action === "dispute" && msg.guest === signer && typeof msg.attended === "boolean"
        && typeof msg.target === "string" && msg.target.length <= 64 && Object.keys(msg).length === 5) dispute = { ...payment, target: msg.target, attended: msg.attended };
      else throw new Error();
    } else if (intent.intent === "auth_call") {
      // The escrow refuses NEAR attached to `on_auth`; the verifier would not refund it anyway.
      if (intent.contract_id !== EVENTS_CONTRACT || intent.attached_deposit !== undefined || intent.min_gas !== undefined
        || typeof intent.msg !== "string") throw new Error();
      const msg = JSON.parse(intent.msg);
      if (msg.action === "create_event") {
        const capacity = Number(msg.capacity);
        const endsAt = Number(msg.metadata?.ends_at);
        const title = msg.metadata?.title;
        // The escrow's own create checks, so a refused create cannot be repeated at the relayer's cost.
        if (!Number.isSafeInteger(capacity) || !Number.isSafeInteger(endsAt) || capacity < 1 || capacity > MAX_CAPACITY
          || typeof title !== "string" || !title.trim() || title.length > 120
          || !(Number(msg.metadata?.starts_at) <= endsAt) || !positiveAmount(msg.deposit) || BigInt(msg.deposit) < 100_000n) throw new Error();
        hostAction = { create: { capacity, endsAt } };
      } else if ((msg.action === "finalize" || msg.action === "cancel") && Number.isSafeInteger(msg.event_id) && msg.event_id >= 0) {
        if (msg.action === "finalize" && (!Array.isArray(msg.attended) || msg.attended.length > MAX_CAPACITY)) throw new Error();
        hostAction = { eventId: msg.event_id, finalize: msg.action === "finalize" };
      } else throw new Error();
    } else if (intent.intent !== "transfer" || typeof intent.receiver_id !== "string"
      || intent.receiver_id.length > 64 || !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(intent.receiver_id)
      || Object.keys(intent.tokens).join() !== `nep141:${USDC_CONTRACT}`
      || !positiveAmount(intent.tokens[`nep141:${USDC_CONTRACT}`])) throw new Error();
    else transfer = intent.tokens[`nep141:${USDC_CONTRACT}`];

    if (erc191Signer(signed.payload, baseDecode(signed.signature.slice("secp256k1:".length))) !== signer) throw new Error();
  } catch {
    return Response.json({ error: "Invalid Nearvent intent or signature" }, { status: 400 });
  }

  try {
    // Any payment from Intents: the verifier would fail on a short balance after the relayer paid.
    const amount = (registration ?? bond ?? dispute)?.amount ?? transfer;
    if (amount) {
      const balance = await view<string>("mt_balance_of", { account_id: signer, token_id: `nep141:${USDC_CONTRACT}` }, INTENTS_CONTRACT);
      if (BigInt(balance) < BigInt(amount)) {
        return Response.json({ error: "Not enough USDC in NEAR Intents for this payment." }, { status: 409 });
      }
    }
    if (registration) {
      const event = await events.get(registration.eventId);
      const existing = await events.guestStatus(registration.eventId, signer);
      if (!event || event.status !== "Open" || Date.now() >= registrationEndsAt(event) || event.guest_count >= event.capacity
        || existing || event.deposit !== registration.amount || needsBond(event) || event.host === signer
        || (event.access && !(await events.checkAccess(event.id, signer)).allowed)) {
        return Response.json({ error: "This registration is unavailable. Your USDC is still in NEAR Intents." }, { status: 409 });
      }
    }
    // A bond or dispute the escrow would refuse comes back, but the relayer still pays the gas.
    if (bond) {
      const event = await events.get(bond.eventId);
      if (!event || event.mode === "Ticket" || event.status !== "Open" || Date.now() >= registrationEndsAt(event)
        || event.host_bond !== "0" || bond.amount !== hostBondFor(event)) {
        return Response.json({ error: "This event takes no host bond now. Your USDC is still in NEAR Intents." }, { status: 409 });
      }
    }
    if (dispute) {
      const event = await events.get(dispute.eventId);
      const [guests, disputes] = await Promise.all([events.guests(dispute.eventId), events.disputes(dispute.eventId)]);
      const target = guests.find((g) => g.account_id === dispute!.target);
      const self = dispute.target === signer;
      // The escrow's own rules: "I came" only for yourself and only if left off; "X did not come" only about a listed other guest.
      const legal = !!target && guests.some((g) => g.account_id === signer) && !disputes.some((d) => d.target === dispute!.target)
        && (dispute.attended ? self && !target.listed : !self && !!target.listed)
        // One "did not come" per guest per event (the escrow refuses a second).
        && !(!dispute.attended && disputes.some((d) => d.challenger === signer && !d.attended));
      if (!event || event.status !== "Submitted" || Date.now() >= (event.challenge_ends_at ?? 0) || dispute.amount !== event.deposit || !legal) {
        return Response.json({ error: "This dispute is unavailable. Your USDC is still in NEAR Intents." }, { status: 409 });
      }
    }
    // Host actions that would fail on chain still burn relayer gas; refuse them here.
    if (hostAction && "create" in hostAction) {
      if (!(await events.canCreate(signer))) {
        return Response.json({ error: "Only verified hosts can create events right now." }, { status: 409 });
      }
      if (await events.createCost(signer, hostAction.create.capacity, hostAction.create.endsAt) !== "0") {
        return Response.json({ error: "Wallets outside NEAR can create free events only: up to 50 seats, 2 in 30 days, ending within 60 days." }, { status: 409 });
      }
    } else if (hostAction) {
      const event = await events.get(hostAction.eventId);
      if (!event || event.host !== signer || event.status !== "Open") {
        return Response.json({ error: "Only the host can close this event while it is open." }, { status: 409 });
      }
      if (hostAction.finalize && Date.now() < event.metadata.ends_at) {
        return Response.json({ error: "You can publish the list once the event ends." }, { status: 409 });
      }
      if (hostAction.finalize && event.mode !== "Ticket" && event.submit_by && Date.now() > event.submit_by) {
        return Response.json({ error: "Too late to publish the list: the event can only be refunded." }, { status: 409 });
      }
      if (!hostAction.finalize && event.mode !== "Ticket" && event.host_bond !== "0" && Date.now() >= event.metadata.starts_at) {
        return Response.json({ error: "The event has started, so it can't be cancelled: publish the list instead." }, { status: 409 });
      }
    }
    // A host publishing its list or a guest disputing in the window stand to lose money if the
    // shared relayer budget runs out, so their requests skip it (per-IP and per-account limits stay).
    const critical = !!dispute || (!!hostAction && "finalize" in hostAction && hostAction.finalize);
    if (await paidRequestLimited(req, "execute", signer, nonce, critical)) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
    const outcome = await relayer().callFunctionRaw({
      contractId: INTENTS_CONTRACT,
      methodName: "execute_intents",
      args: { signed: [signed] },
      gas: 300_000_000_000_000n,
      waitUntil: "FINAL",
    });
    const status = outcome.status as { Failure?: unknown };
    if (status.Failure) return Response.json({ error: "Intent rejected", detail: status.Failure }, { status: 502 });
    // `auth_call` runs the escrow's `on_auth` detached: the transaction succeeds even when the escrow refuses.
    // A refused bond or dispute fails inside `ft_on_transfer`, and the token returns the USDC.
    const refused = (hostAction || bond || dispute) && outcome.receipts_outcome.map((r) => r.outcome.status as { Failure?: unknown }).find((s) => s.Failure);
    if (refused) {
      const reason = JSON.stringify(refused.Failure).match(/panicked: ([^"\\]+)/)?.[1];
      return Response.json({ error: reason ? `The escrow refused: ${reason}` : "The escrow refused this action" }, { status: 409 });
    }
    // A refused registration does not panic (the escrow returns the USDC), so look for the seat.
    if (registration && !(await events.guestStatus(registration.eventId, signer).catch(() => null))) {
      return Response.json({ error: "The escrow did not take the registration. Your USDC is back in NEAR Intents." }, { status: 409 });
    }
    // EVM guests have no staff token; the registration they just signed is their proof for the display name.
    const name = registration && cleanGuestName(signed.name);
    if (name) await setGuestName(registration!.eventId, signer, name).catch(() => {});
    return Response.json({ hash: outcome.transaction.hash });
  } catch {
    return Response.json({ error: "Intent status unavailable. Check your event or Intents balance before retrying." }, { status: 502 });
  }
}
