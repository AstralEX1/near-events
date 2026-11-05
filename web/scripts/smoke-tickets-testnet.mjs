// Paid-ticket cycle on testnet (Tidepool USDC): create a Ticket event →
// guest buys a ticket → closing before the start is refused → after the start
// the host closes and gets the ticket money → host moves it into their NEAR
// Intents account. Then a second event is cancelled and the ticket refunded.
// Keys are read from ~/.near-credentials (never printed).
// Env: EVENTS_CONTRACT (escrow-v4 code or later), HOST_ACCOUNT, GUEST_ACCOUNT.
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
const create = (title, startsAt) =>
  call(host, EVENTS, "create_event", {
    metadata: { title, description: "Automated ticket run", location: "Online", cover_url: null, starts_at: startsAt, ends_at: startsAt + 3600_000 },
    deposit: PRICE,
    capacity: 5,
    cohosts: null,
    mode: "Ticket",
  });
const buy = (eventId) =>
  call(guest, USDC, "ft_transfer_call", { receiver_id: EVENTS, amount: PRICE, msg: JSON.stringify({ action: "register", event_id: eventId }) }, 1n, 100n * TGAS);

if (BigInt(await view("ft_balance_of", { account_id: GUEST }, USDC)) < 2n * BigInt(PRICE)) {
  const r = await fetch("https://www.usetidepool.tech/v0/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: GUEST, mode: "wallet" }) });
  console.log("0. faucet", r.status);
}

// 1. A Ticket event that starts in 60 seconds.
const startsAt = Date.now() + 60_000;
const eventId = await create("Ticket smoke test", startsAt);
const e = await view("get_event", { event_id: eventId });
console.log("1. event", eventId, "mode", e.mode, "price", e.price);

// 2. Guest buys a ticket.
await buy(eventId);
console.log("2. bought, guest status", await view("get_guest_status", { event_id: eventId, account_id: GUEST }));

// 3. Closing before the start must fail.
try {
  await call(host, EVENTS, "finalize", { event_id: eventId }, 1n, 100n * TGAS);
  throw new Error("finalize before the start went through");
} catch (err) {
  if (!String(err).includes("released once the event has started")) throw err;
  console.log("3. finalize before the start refused");
}

// 4. After the start the host closes and is paid, though nobody was checked in.
await sleep(Math.max(0, startsAt - Date.now()) + 5_000);
const hostBefore = BigInt(await view("balance_of", { account_id: HOST }));
await call(host, EVENTS, "finalize", { event_id: eventId }, 1n, 100n * TGAS);
const hostAfter = BigInt(await view("balance_of", { account_id: HOST }));
console.log("4. finalized, host +", (hostAfter - hostBefore).toString(), "guest balance", await view("balance_of", { account_id: GUEST }));
if (hostAfter - hostBefore !== BigInt(PRICE)) throw new Error("host was not paid the ticket");

// 5. Host moves the ticket money into their NEAR Intents account.
const intentsBefore = BigInt(await view("mt_balance_of", { account_id: HOST, token_id: `nep141:${USDC}` }, VERIFIER));
await call(host, EVENTS, "withdraw", { amount: null, receiver_id: null, to_intents: true }, 1n, 200n * TGAS);
const intentsAfter = BigInt(await view("mt_balance_of", { account_id: HOST, token_id: `nep141:${USDC}` }, VERIFIER));
console.log("5. into Intents account", HOST, "+", (intentsAfter - intentsBefore).toString());

// 6. A second Ticket event is cancelled: the guest gets the ticket back.
const second = await create("Ticket cancel test", Date.now() + 3600_000);
const guestBefore = BigInt(await view("balance_of", { account_id: GUEST }));
await buy(second);
await call(host, EVENTS, "cancel", { event_id: second }, 1n, 100n * TGAS);
const guestAfter = BigInt(await view("balance_of", { account_id: GUEST }));
console.log("6. cancelled event", second, "guest refunded +", (guestAfter - guestBefore).toString());
if (guestAfter - guestBefore !== BigInt(PRICE)) throw new Error("ticket was not refunded");
console.log("OK");
