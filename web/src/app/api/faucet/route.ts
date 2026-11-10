import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { INTENTS_CONTRACT, NETWORK, TEST_EVM_FAUCET_LIMIT, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { view } from "@/lib/near";

// Testnet only: the relayer hands out its own test USDC, topping an account up
// to TEST_EVM_FAUCET_LIMIT. NEAR accounts get it on the USDC contract; EVM
// sign-ins (0x…) get it in their NEAR Intents balance on the Tidepool verifier.
// Tidepool's /v0/faucet API is closed (site-only since 2026-11-09), so when the
// relayer runs dry it says so instead of calling it.

/** NEP-145 registration on the USDC contract: 0.00125 NEAR, paid by the relayer. */
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;
const usdcOf = (account_id: string) => view<string>("ft_balance_of", { account_id }, USDC_CONTRACT).then(BigInt);

async function relayerWithUsdc(amount: bigint) {
  const r = relayer();
  if (await usdcOf(r.accountId) < amount) throw new Error("The test USDC faucet is empty. Ask the Nearvent team to top it up.");
  return r;
}

async function fundEvmIntents(address: string) {
  const held = BigInt(await view<string>("mt_balance_of", { account_id: address, token_id: `nep141:${USDC_CONTRACT}` }, INTENTS_CONTRACT!));
  if (held >= TEST_EVM_FAUCET_LIMIT) return { funded: "0" };
  const amount = TEST_EVM_FAUCET_LIMIT - held;
  await (await relayerWithUsdc(amount)).callFunction({
    contractId: USDC_CONTRACT,
    methodName: "ft_transfer_call",
    args: { receiver_id: INTENTS_CONTRACT, amount: amount.toString(), msg: address },
    deposit: 1n,
    gas: 100_000_000_000_000n,
  });
  return { funded: amount.toString() };
}

async function fundNearAccount(accountId: string) {
  const held = await usdcOf(accountId);
  if (held >= TEST_EVM_FAUCET_LIMIT) return { funded: "0" };
  const amount = TEST_EVM_FAUCET_LIMIT - held;
  const r = await relayerWithUsdc(amount);
  if ((await view<object | null>("storage_balance_of", { account_id: accountId }, USDC_CONTRACT)) === null) {
    await r.callFunction({
      contractId: USDC_CONTRACT,
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      deposit: STORAGE_DEPOSIT,
      gas: 30_000_000_000_000n,
    });
  }
  await r.callFunction({
    contractId: USDC_CONTRACT,
    methodName: "ft_transfer",
    args: { receiver_id: accountId, amount: amount.toString() },
    deposit: 1n,
    gas: 30_000_000_000_000n,
  });
  return { funded: amount.toString() };
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (NETWORK !== "testnet") return Response.json({ error: "Faucet is not available here" }, { status: 403 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    if (/^0x[0-9a-f]{40}$/.test(accountId)) {
      if (!INTENTS_CONTRACT) return Response.json({ error: "NEAR Intents is not configured" }, { status: 403 });
      if (await paidRequestLimited(req, "faucet", accountId)) return Response.json({ error: "Faucet quota unavailable or exceeded" }, { status: 429 });
      return Response.json(await fundEvmIntents(accountId));
    }
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return Response.json({ error: "Bad request" }, { status: 400 });
    if (await paidRequestLimited(req, "faucet", accountId)) return Response.json({ error: "Faucet quota unavailable or exceeded" }, { status: 429 });
    return Response.json(await fundNearAccount(accountId));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
