// Runs a full Near Events cycle on testnet: create → register → check in → finalize → withdraw.
// Keys are read from ~/.near-credentials (never printed). Account names come from env:
//   EVENTS_CONTRACT, USDC_CONTRACT, HOST_ACCOUNT, GUEST_ACCOUNT
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
const USDC = env("USDC_CONTRACT");
const HOST = env("HOST_ACCOUNT");
const GUEST = env("GUEST_ACCOUNT");
const TGAS = 1_000_000_000_000n;

const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const key = (id) =>
  JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
const account = (id) => new Account(id, provider, key(id));
const view = (method, args = {}, contractId = EVENTS) =>
  provider.callFunction({ contractId, method, args });

const host = account(HOST);
const guest = account(GUEST);

const call = (who, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunction({ contractId, methodName, args, deposit, gas });

const storage = await view("storage_cost", { capacity: 5 });
const now = Date.now();
const eventId = await call(host, EVENTS, "create_event", {
  metadata: {
    title: "Smoke test meetup",
    description: "Automated testnet run",
    location: "Online",
    cover_url: null,
    starts_at: now,
    ends_at: now + 3600_000,
  },
  deposit: "10000000",
  capacity: 5,
  cohosts: [GUEST],
}, BigInt(storage));
console.log("event", eventId);

// The escrow must be registered with the token to receive USDC (one-time).
if (!(await view("storage_balance_of", { account_id: EVENTS }, USDC))) {
  await call(guest, USDC, "mint", { amount: "0", account_id: EVENTS });
}
await call(guest, USDC, "mint", { amount: "20000000" });
console.log("guest USDC", await view("ft_balance_of", { account_id: GUEST }, USDC));

await call(guest, USDC, "ft_transfer_call", {
  receiver_id: EVENTS,
  amount: "10000000",
  msg: JSON.stringify({ action: "register", event_id: eventId }),
}, 1n);
console.log("status", await view("get_guest_status", { event_id: eventId, account_id: GUEST }));

await call(host, EVENTS, "check_in", { event_id: eventId, accounts: [GUEST] }, 1n);
await call(host, EVENTS, "finalize", { event_id: eventId }, 1n);
console.log("event", JSON.stringify(await view("get_event", { event_id: eventId })));
console.log("balance", await view("balance_of", { account_id: GUEST }));

await call(guest, EVENTS, "withdraw", { amount: null, receiver_id: null, to_intents: null }, 1n);
console.log("balance after withdraw", await view("balance_of", { account_id: GUEST }));
console.log("guest USDC", await view("ft_balance_of", { account_id: GUEST }, USDC));
