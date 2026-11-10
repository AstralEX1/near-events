import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { view } from "@/lib/near";

// "Send to Intents" button: the relayer calls `payout_to_intents`, which can
// only move an account's balance into that same account's Intents balance.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
  try {
    const { accountId, amount } = await req.json();
    if (typeof accountId !== "string" || !/^0x[0-9a-f]{40}$/.test(accountId)
      || typeof amount !== "string" || !/^[1-9][0-9]{0,38}$/.test(amount)) {
      return Response.json({ error: "Invalid account or amount" }, { status: 400 });
    }
    if (BigInt(await view<string>("balance_of", { account_id: accountId })) < BigInt(amount)) {
      return Response.json({ error: "Insufficient escrow balance" }, { status: 409 });
    }
    if (await paidRequestLimited(req, "payout", accountId)) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
    const outcome = await relayer().callFunctionRaw({
      contractId: EVENTS_CONTRACT,
      methodName: "payout_to_intents",
      args: { account_id: accountId, amount },
      gas: 200_000_000_000_000n,
      waitUntil: "FINAL",
    });
    const hash = outcome.transaction.hash;
    const value = (outcome.status as { SuccessValue?: string }).SuccessValue;
    const sent = value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : null;
    if (sent !== amount) {
      return Response.json({ hash, sent, error: sent === "0"
        ? "The payout was returned to your Nearvent balance."
        : "The full payout is not confirmed. Check your Nearvent and Intents balances before retrying." }, { status: 409 });
    }
    return Response.json({ hash, sent });
  } catch {
    return Response.json({ error: "Payout status unavailable. Check your balances before retrying." }, { status: 502 });
  }
}
