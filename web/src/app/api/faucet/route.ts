import { rateLimited } from "@/lib/ratelimit";
import { INTENTS_CONTRACT, NETWORK, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { view } from "@/lib/near";
import { ONECLICK_URL } from "@/lib/oneclick";

// Testnet only. NEAR accounts: asks the Tidepool faucet for test USDC on the
// account (100 USDC, once an hour). EVM sign-ins (0x…): the relayer deposits
// test USDC into that address's NEAR Intents balance on the Tidepool verifier,
// topping its own wallet up from the faucet when it runs low.
const EVM_DRIP = 20_000_000n; // 20 USDC

async function tidepoolFaucet(accountId: string) {
  const res = await fetch(`${ONECLICK_URL}/v0/faucet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, mode: "wallet" }),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message ?? json.error ?? `Faucet error ${res.status}`);
  return json;
}

async function fundEvmIntents(address: string) {
  const held = BigInt(await view<string>("mt_balance_of", { account_id: address, token_id: `nep141:${USDC_CONTRACT}` }, INTENTS_CONTRACT!));
  if (held >= EVM_DRIP) return { funded: "0" };
  const r = relayer();
  if (BigInt(await view<string>("ft_balance_of", { account_id: r.accountId }, USDC_CONTRACT)) < EVM_DRIP) await tidepoolFaucet(r.accountId);
  await r.callFunction({
    contractId: USDC_CONTRACT,
    methodName: "ft_transfer_call",
    args: { receiver_id: INTENTS_CONTRACT, amount: EVM_DRIP.toString(), msg: address },
    deposit: 1n,
    gas: 100_000_000_000_000n,
  });
  return { funded: EVM_DRIP.toString() };
}
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (NETWORK !== "testnet") return Response.json({ error: "Testnet only" }, { status: 403 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    if (/^0x[0-9a-f]{40}$/.test(accountId)) {
      if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
      return Response.json(await fundEvmIntents(accountId));
    }
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return Response.json({ error: "Bad request" }, { status: 400 });
    return Response.json(await tidepoolFaucet(accountId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
