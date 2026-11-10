// Paid-ticket cycle on testnet (Tidepool USDC): create a Ticket event →
// guest buys a ticket and the host is paid at once → the host closes the event
// (allowed before the start) → host moves the money into their NEAR Intents
// account. Then a second event is cancelled; the ticket is not refunded.
// Keys are read from ~/.near-credentials (never printed).
// Env: EVENTS_CONTRACT (the current escrow), HOST_ACCOUNT, GUEST_ACCOUNT.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
const HOST = env("HOST_ACCOUNT");
const GUEST = env("GUEST_ACCOUNT");
const USDC = "usdc.tidepool-sandbox.testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;
const PRICE = "1000000"; // 1 USDC ticket

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
const create = (title, startsAt) =>
  call(host, EVENTS, "create_event", {
    metadata: { title, starts_at: startsAt, ends_at: startsAt + 3600_000 },
    deposit: PRICE,
    capacity: 5,
    mode: "Ticket",
  });
const buy = (eventId) =>
  call(guest, USDC, "ft_transfer_call", { receiver_id: EVENTS, amount: PRICE, msg: JSON.stringify({ action: "register", event_id: eventId }) }, 1n, 100n * TGAS);

if (BigInt(await view("ft_balance_of", { account_id: GUEST }, USDC)) < 2n * BigInt(PRICE)) {
  const r = await fetch("https://www.usetidepool.tech/v0/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: GUEST, mode: "wallet" }) });
  console.log("0. faucet", r.status);
}

// 1. A Ticket event that starts in an hour.
const startsAt = Date.now() + 3600_000;
const eventId = await create("Ticket smoke test", startsAt);
const e = await view("get_event", { event_id: eventId });
console.log("1. event", eventId, "mode", e.mode, "deposit", e.deposit);

// 2. Guest buys a ticket; the host is paid right away.
const hostBefore = BigInt(await view("balance_of", { account_id: HOST }));
await buy(eventId);
const registration = await waitFor(
  () => view("get_guest_status", { event_id: eventId, account_id: GUEST }),
  (status) => status === "Registered",
  "guest registration",
);
const hostAfter = BigInt(await waitFor(
  () => view("balance_of", { account_id: HOST }),
  (balance) => BigInt(balance) === hostBefore + BigInt(PRICE),
  "Ticket payment to host",
));
console.log("2. bought, guest status", registration, "host +", (hostAfter - hostBefore).toString());

// 3-4. The host can close before the start; that pays nothing more.
await call(host, EVENTS, "finalize", { event_id: eventId, attended: [] }, 1n, 100n * TGAS);
if (BigInt(await view("balance_of", { account_id: HOST })) !== hostAfter) throw new Error("finalize changed the host balance");
console.log("3-4. finalized before the start, guest balance", await view("balance_of", { account_id: GUEST }));

// 5. Host moves the ticket money into their NEAR Intents account.
const intentsBefore = BigInt(await view("mt_balance_of", { account_id: HOST, token_id: `nep141:${USDC}` }, VERIFIER));
const internalBalanceToWithdraw = hostAfter;
await call(host, EVENTS, "withdraw", { amount: null, receiver_id: null, to_intents: true }, 1n, 200n * TGAS);
const intentsAfter = BigInt(await waitFor(
  () => view("mt_balance_of", { account_id: HOST, token_id: `nep141:${USDC}` }, VERIFIER),
  (balance) => BigInt(balance) === intentsBefore + internalBalanceToWithdraw,
  "Ticket payout in Intents",
));
await waitFor(
  () => view("balance_of", { account_id: HOST }),
  (balance) => BigInt(balance) === 0n,
  "escrow balance after withdrawal",
);
console.log("5. into Intents account", HOST, "+", (intentsAfter - intentsBefore).toString());

// 6. A second Ticket event is cancelled: nothing is refunded, the host keeps the ticket.
const second = await create("Ticket cancel test", Date.now() + 3600_000);
const guestBefore = BigInt(await view("balance_of", { account_id: GUEST }));
await buy(second);
await waitFor(
  () => view("balance_of", { account_id: HOST }),
  (balance) => BigInt(balance) === BigInt(PRICE),
  "Ticket payment to host",
);
await call(host, EVENTS, "cancel", { event_id: second }, 1n, 100n * TGAS);
const guestAfter = BigInt(await view("balance_of", { account_id: GUEST }));
console.log("6. cancelled event", second, "guest balance change", (guestAfter - guestBefore).toString());
if (guestAfter !== guestBefore) throw new Error("ticket was refunded");
if (BigInt(await view("balance_of", { account_id: HOST })) !== BigInt(PRICE)) throw new Error("host lost the ticket money");
console.log("OK");
