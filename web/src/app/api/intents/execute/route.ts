import { rateLimited } from "@/lib/ratelimit";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";

// Submits a guest's signed intent to intents.near; the relayer pays the gas.
// Only two shapes are relayed: a registration (one `ft_withdraw` of USDC to the
// escrow with a register message) and a cash-out (one USDC `transfer` inside
// NEAR Intents). The signature itself is checked on-chain.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
  const signed = await req.json();
  type Intent = { intent: string; token?: string; receiver_id?: string; msg?: string; tokens?: Record<string, string> };
  let payload: { intents?: Intent[] };
  try {
    payload = JSON.parse(signed.payload);
  } catch {
    return Response.json({ error: "Bad payload" }, { status: 400 });
  }
  const intents = payload.intents ?? [];
  const [one] = intents;
  const isRegister = (i: Intent) => {
    try {
      return (
        i.intent === "ft_withdraw" &&
        i.token === USDC_CONTRACT &&
        i.receiver_id === EVENTS_CONTRACT &&
        JSON.parse(i.msg ?? "{}").action === "register"
      );
    } catch {
      return false;
    }
  };
  // Cash-out: a USDC-only transfer inside NEAR Intents (to a 1Click deposit
  // address or to another Intents account).
  const isCashOut = (i: Intent) =>
    i.intent === "transfer" &&
    /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/.test(i.receiver_id ?? "") &&
    Object.keys(i.tokens ?? {}).join() === `nep141:${USDC_CONTRACT}`;
  const ok = signed.standard === "erc191" && intents.length === 1 && (isRegister(one) || isCashOut(one));
  if (!ok) return Response.json({ error: "Only Near Events registrations and cash-outs are relayed" }, { status: 400 });

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
