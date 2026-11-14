import { rateLimited } from "@/lib/ratelimit";
import { events, type EventView } from "@/lib/near";
import { emptyReputation, isAccountId, reputationIndex, type ChainFacts, type Reputation } from "@/lib/reputationShared";
import { TRUSTED_HOSTS } from "@/lib/trustedHosts";
import { SCORE_VERSION } from "@/lib/score";

// Reputation counters and the single score for up to 100 accounts
// (`?a=alice.near,bob.near`), recomputed from public escrow views.
// shortcut: the chain facts are cached per server instance for 5 minutes and
// reread in full; move to an indexer or Redis once there are thousands of events.
const TTL_MS = 5 * 60_000;
type Index = { facts: ChainFacts; index: Map<string, Reputation> };
let cache: { at: number; facts: Promise<Index> } | null = null;
/** Served while a refresh fails, so a struggling RPC does not trigger a full rescan per request. */
let lastGood: Index | null = null;

async function readFacts(): Promise<Index> {
  const all = await events.all();
  const settled = all.filter((e) => e.status === "Finalized");
  const facts: ChainFacts = { events: all, guests: {}, disputes: {} };
  const disputed = (e: EventView) => (e.upheld_disputes ?? 0) + (e.dismissed_disputes ?? 0) + (e.open_disputes ?? 0) > 0;
  for (let i = 0; i < settled.length; i += 8) {
    await Promise.all(settled.slice(i, i + 8).map(async (e) => {
      const [guests, disputes] = await Promise.all([events.guests(e.id), disputed(e) ? events.disputes(e.id) : []]);
      facts.guests[e.id] = guests;
      facts.disputes[e.id] = disputes;
    }));
  }
  return { facts, index: reputationIndex(facts, TRUSTED_HOSTS) };
}

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const accounts = [...new Set((new URL(req.url).searchParams.get("a") ?? "").split(",").filter(Boolean))];
  if (!accounts.length || accounts.length > 100 || accounts.some((a) => !isAccountId(a))) {
    return Response.json({ error: "Pass ?a= with 1 to 100 account ids" }, { status: 400 });
  }
  if (!cache || Date.now() - cache.at > TTL_MS) {
    const facts = readFacts();
    cache = { at: Date.now(), facts };
    facts.then((good) => (lastGood = good), () => {
      // Retry after a minute, not on the next request.
      if (cache?.facts === facts && lastGood) cache = { at: Date.now() - TTL_MS + 60_000, facts: Promise.resolve(lastGood) };
      else if (cache?.facts === facts) cache = null;
    });
  }
  try {
    const { facts, index } = await cache.facts.catch((e) => {
      if (lastGood) return lastGood;
      throw e;
    });
    const out = Object.fromEntries(accounts.map((a) => [a, index.get(a) ?? emptyReputation(facts, a)]));
    return Response.json({ version: SCORE_VERSION, accounts: out }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch {
    return Response.json({ error: "The chain is unreachable right now" }, { status: 502 });
  }
}
