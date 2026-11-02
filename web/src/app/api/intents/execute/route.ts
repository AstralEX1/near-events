import { rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";

// Submits a guest's signed intent to intents.near; the relayer pays the gas.
// Only Near Events registrations are relayed: one `ft_withdraw` of USDC to the
// escrow with a register message. The signature itself is checked on-chain.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is mainnet only" }, { status: 403 });
  const signed = await req.json();
  let payload: { intents?: { intent: string; token: string; receiver_id: string; msg?: string }[] };
  try {
    payload = JSON.parse(signed.payload);
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  const intents = payload.intents ?? [];
  const ok =
    signed.standard === "erc191" &&
    intents.length === 1 &&
    intents[0].intent === "ft_withdraw" &&
    intents[0].token === USDC_CONTRACT &&
    intents[0].receiver_id === EVENTS_CONTRACT &&
    JSON.parse(intents[0].msg ?? "{}").action === "register";
  if (!ok) return Response.json({ error: "Only Near Events registrations are relayed" }, { status: 400 });

  try {
    const outcome = await relayer().callFunctionRaw({
      contractId: INTENTS_CONTRACT,
      methodName: "execute_intents",
      args: { signed: [signed] },
      gas: 300_000_000_000_000n,
    });
    const status = outcome.status as { Failure?: unknown };
    if (status.Failure) return Response.json({ error: "Intent rejected", detail: status.Failure }, { status: 502 });
    return Response.json({ hash: outcome.transaction.hash });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
