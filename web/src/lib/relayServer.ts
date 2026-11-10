import "server-only";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "./config";
import { events } from "./near";
import type { Contracts, Payload } from "./relayPolicy";

export const CONTRACTS: Contracts = { events: EVENTS_CONTRACT, usdc: USDC_CONTRACT, intents: INTENTS_CONTRACT };

// The relayer pays gas for free-tier events only; a bigger event or a
// third open one must carry its own storage deposit, or it would just fail.
export async function unpaidBeyondFreeTier(p: Payload): Promise<boolean> {
  if (p.receiverId !== EVENTS_CONTRACT) return false;
  for (const call of p.calls) {
    if (call.methodName !== "create_event") continue;
    const args = JSON.parse(new TextDecoder().decode(call.args));
    const endsAt = Number(args.metadata?.ends_at);
    const cost = BigInt(await events.createCost(p.signerId, Number(args.capacity), Number.isSafeInteger(endsAt) ? endsAt : undefined));
    if (cost > 0n && call.deposit < cost) return true;
  }
  return false;
}

export const FREE_TIER_ERROR =
  "Free events are up to 50 seats and 2 open events per host, ending within 60 days. Attach the storage deposit shown on the create page.";
