import { rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { view } from "@/lib/near";

// "Send to Intents" button: the relayer calls `payout_to_intents`, which can
// only move an account's balance into that same account's Intents balance.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  if (BigInt(await view<string>("balance_of", { account_id: accountId })) === 0n) {
    return Response.json({ error: "Nothing to pay out" }, { status: 400 });
  }
  try {
    const outcome = await relayer().callFunctionRaw({
      contractId: EVENTS_CONTRACT,
      methodName: "payout_to_intents",
      args: { account_id: accountId, amount: null },
      gas: 200_000_000_000_000n,
    });
    return Response.json({ hash: outcome.transaction.hash });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
