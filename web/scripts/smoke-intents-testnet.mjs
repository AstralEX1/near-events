// Full Near Me cycle on testnet with every payment through NEAR Intents
// (Tidepool's 1Click sandbox): create → fund guest Intents → register → check in →
// finalize → withdraw to another chain via 1Click → withdraw into an Intents account.
// Keys are read from ~/.near-credentials (never printed).
// Env: EVENTS_CONTRACT, HOST_ACCOUNT, GUEST_ACCOUNT, optional EVM_ADDRESS (payout on Base Sepolia).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider, parseNearAmount } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
const HOST = env("HOST_ACCOUNT");
const GUEST = env("GUEST_ACCOUNT");
const EVM = process.env.EVM_ADDRESS ?? "0x000000000000000000000000000000000000dEaD";
const API = "https://www.usetidepool.tech";
const USDC = "usdc.tidepool-sandbox.testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";
const USDC_ASSET = `nep141:${USDC}`;
const USDT = "usdt.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const key = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
const host = new Account(HOST, provider, key(HOST));
const guest = new Account(GUEST, provider, key(GUEST));
const view = (method, args = {}, contractId = EVENTS) => provider.callFunction({ contractId, method, args });
const call = (who, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (read, matches, description, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (matches(value)) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${description}; last value: ${String(value)}`);
};
const api = async (path, body) => {
  const r = await fetch(`${API}${path}`, {
    ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j;
};
const deadline = () => new Date(Date.now() + 30 * 60_000).toISOString();
const requireDelivery = async (addr) => {
  for (let i = 0; i < 60; i++) {
    const s = (await api(`/v0/status?depositAddress=${addr}`)).status;
    if (s === "SUCCESS") return;
    if (["REFUNDED", "FAILED", "INCOMPLETE_DEPOSIT"].includes(s)) throw new Error(`Swap failed: ${s}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Timed out waiting for the existing swap");
};
const payAddress = async (who, token, addr, amount) => {
  await call(who, token, "storage_deposit", { account_id: addr, registration_only: true }, BigInt(parseNearAmount("0.00125")), 30n * TGAS);
  await call(who, token, "ft_transfer", { receiver_id: addr, amount }, 1n, 50n * TGAS);
};

// Second run onward: skip the faucet if it is still cooling down.
// 1. Host creates a free event (the escrow pays storage).
const now = Date.now();
const DEPOSIT = "1000000"; // 1 USDC
const eventId = await call(host, EVENTS, "create_event", {
  metadata: { title: "Intents smoke test", starts_at: now, ends_at: now + 3600_000 },
  deposit: DEPOSIT,
  capacity: 5,
});
console.log("1. event", eventId);
const escrowBalanceBefore = BigInt(await view("balance_of", { account_id: GUEST }));

// 2. Guest gets test tokens and pays the deposit through 1Click. Tidepool
// rejects same-asset quotes (mainnet 1Click allows USDC → USDC), so pay in USDT.
const faucet = await fetch(`${API}/v0/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: GUEST, mode: "wallet" }) });
console.log("2. faucet", faucet.status, "guest USDC", await view("ft_balance_of", { account_id: GUEST }, USDC));
const intentsBalance = async (account_id) => BigInt(await view("mt_balance_of", { account_id, token_id: USDC_ASSET }, VERIFIER));
const beforeFunding = await intentsBalance(GUEST);
const { quote } = await api("/v0/quote", {
  dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: `nep141:${USDT}`, depositType: "ORIGIN_CHAIN",
  destinationAsset: USDC_ASSET, amount: DEPOSIT, refundTo: GUEST, refundType: "ORIGIN_CHAIN",
  recipient: GUEST, recipientType: "INTENTS", deadline: deadline(),
});
console.log("   quote amountIn", quote.amountIn, "→", quote.depositAddress);
await payAddress(guest, USDT, quote.depositAddress, quote.amountIn);
await requireDelivery(quote.depositAddress);
assert.ok(await intentsBalance(GUEST) >= beforeFunding + BigInt(DEPOSIT), "1Click did not credit the guest");
const sent = await call(guest, VERIFIER, "ft_withdraw", {
  token: USDC, receiver_id: EVENTS, amount: DEPOSIT,
  msg: JSON.stringify({ action: "register", event_id: eventId, guest: GUEST }),
}, 1n, 200n * TGAS);
assert.equal(sent, DEPOSIT, "Verifier did not deliver the registration payment");
assert.equal(await view("get_guest_status", { event_id: eventId, account_id: GUEST }), "Registered");

// A duplicate must return to the withdrawing Intents account, without a new escrow credit.
await call(guest, USDC, "ft_transfer_call", { receiver_id: VERIFIER, amount: DEPOSIT, msg: GUEST }, 1n);
const beforeDuplicate = await intentsBalance(GUEST);
const unused = await call(guest, VERIFIER, "ft_withdraw", {
  token: USDC, receiver_id: EVENTS, amount: DEPOSIT,
  msg: JSON.stringify({ action: "register", event_id: eventId, guest: GUEST }),
}, 1n, 200n * TGAS);
assert.equal(unused, "0", "The duplicate must consume zero USDC");
assert.equal(await intentsBalance(GUEST), beforeDuplicate);
assert.equal(BigInt(await view("balance_of", { account_id: GUEST })), escrowBalanceBefore);

// 3. Check in and close.
await call(host, EVENTS, "finalize", { event_id: eventId, attended: [GUEST] }, 1n, 300n * TGAS);
const balance = BigInt(await waitFor(
  () => view("balance_of", { account_id: GUEST }),
  (value) => BigInt(value) === escrowBalanceBefore + BigInt(DEPOSIT),
  "Deposit payout to guest",
));
const eventPayout = balance - escrowBalanceBefore;

// 4. Half goes to Base Sepolia through 1Click, straight from the escrow.
const half = (eventPayout / 2n).toString();
const out = (await api("/v0/quote", {
  dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC_ASSET, depositType: "ORIGIN_CHAIN",
  destinationAsset: "nep141:base-0x38d81431b9f76d9699af7517040d5221d9dea252.tp-omft.testnet", amount: half,
  refundTo: GUEST, refundType: "INTENTS", recipient: EVM, recipientType: "DESTINATION_CHAIN", deadline: deadline(),
})).quote;
await call(guest, USDC, "storage_deposit", { account_id: out.depositAddress, registration_only: true }, BigInt(parseNearAmount("0.00125")), 30n * TGAS);
assert.equal(await call(guest, EVENTS, "withdraw", { amount: out.amountIn, receiver_id: out.depositAddress, to_intents: false }, 1n, 200n * TGAS), out.amountIn);
await requireDelivery(out.depositAddress);

// 5. The rest goes into the host's NEAR Intents account (like a near.com wallet).
const before = BigInt(await view("mt_balance_of", { account_id: HOST, token_id: USDC_ASSET }, VERIFIER));
const remaining = eventPayout - BigInt(out.amountIn);
await call(guest, EVENTS, "withdraw", { amount: remaining.toString(), receiver_id: HOST, to_intents: true }, 1n, 200n * TGAS);
const after = BigInt(await waitFor(
  () => view("mt_balance_of", { account_id: HOST, token_id: USDC_ASSET }, VERIFIER),
  (value) => BigInt(value) === before + remaining,
  "remaining payout in host Intents balance",
));
assert.equal(after - before, remaining);
assert.equal(BigInt(await view("balance_of", { account_id: GUEST })), escrowBalanceBefore);
console.log("Tidepool delivery, registration, duplicate refund and cash-out passed");
