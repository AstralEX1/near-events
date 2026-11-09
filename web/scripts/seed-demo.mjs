// Creates an open demo event on testnet with one registered guest.
// Keys are read from ~/.near-credentials (never printed). Env: EVENTS_CONTRACT, USDC_CONTRACT, HOST_ACCOUNT, GUEST_ACCOUNT
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [EVENTS, USDC, HOST, GUEST] = ["EVENTS_CONTRACT", "USDC_CONTRACT", "HOST_ACCOUNT", "GUEST_ACCOUNT"].map(env);
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const account = (id) =>
  new Account(id, provider, JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key);
const gas = 100_000_000_000_000n;

const start = new Date(Date.now() + 3 * 24 * 3600_000);
start.setHours(18, 30, 0, 0);
const id = await account(HOST).callFunction({
  contractId: EVENTS,
  methodName: "create_event",
  args: {
    metadata: {
      // Description and location are saved off-chain from the Manage page (api/event-details).
      title: "NEAR Builders Night Belgrade",
      starts_at: start.getTime(),
      ends_at: start.getTime() + 3 * 3600_000,
    },
    deposit: "5000000",
    capacity: 40,
  },
  gas,
});
const guest = account(GUEST);
const storage = await provider.callFunction({ contractId: USDC, method: "storage_balance_bounds", args: {} });
await guest.callFunction({
  contractId: USDC, methodName: "storage_deposit",
  args: { account_id: guest.accountId, registration_only: true }, deposit: BigInt(storage.min), gas,
});
await guest.callFunction({ contractId: USDC, methodName: "mint", args: { amount: "5000000" }, gas });
await guest.callFunction({
  contractId: USDC,
  methodName: "ft_transfer_call",
  args: { receiver_id: EVENTS, amount: "5000000", msg: JSON.stringify({ action: "register", event_id: id }) },
  deposit: 1n,
  gas,
});
console.log("demo event", id);
