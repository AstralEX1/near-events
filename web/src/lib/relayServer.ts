import "server-only";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "./config";
import { events } from "./near";
import type { Contracts, Payload } from "./relayPolicy";

export const CONTRACTS: Contracts = { events: EVENTS_CONTRACT, usdc: USDC_CONTRACT, intents: INTENTS_CONTRACT };

// Calls the escrow would refuse still burn relayer gas, so they are refused
// here: a host off the whitelist (when it is on), a create beyond the free
// tier without its storage deposit, and a finalize before the event ends.
// Returns the reason, or null when the payload may be relayed.
export async function relayRefusal(p: Payload): Promise<string | null> {
  if (p.receiverId !== EVENTS_CONTRACT) return null;
  for (const call of p.calls) {
    if (call.methodName !== "create_event" && call.methodName !== "finalize") continue;
    const args = JSON.parse(new TextDecoder().decode(call.args));
    if (call.methodName === "create_event") {
      if (!(await events.canCreate(p.signerId))) return HOST_ERROR;
      const endsAt = Number(args.metadata?.ends_at);
      const cost = BigInt(await events.createCost(p.signerId, Number(args.capacity), Number.isSafeInteger(endsAt) ? endsAt : undefined));
      if (cost > 0n && call.deposit < cost) return FREE_TIER_ERROR;
    } else if (call.methodName === "finalize") {
      const event = await events.get(Number(args.event_id));
      if (event && Date.now() < event.metadata.ends_at) return FINALIZE_ERROR;
    }
  }
  return null;
}

export const HOST_ERROR = "Only verified hosts can create events right now.";
export const FINALIZE_ERROR = "You can close the event once it ends. To refund everyone now, cancel it.";
export const FREE_TIER_ERROR =
  "Free events are up to 50 seats, 2 per host in 30 days, ending within 60 days. Attach the storage deposit shown on the create page.";
