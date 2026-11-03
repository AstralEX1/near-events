// Creates three open Bali demo events on testnet for the embed demo (docs/EMBED.md).
// Keys are read from ~/.near-credentials (never printed). Env: EVENTS_CONTRACT, USDC_CONTRACT, HOST_ACCOUNT, GUEST_ACCOUNT
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [EVENTS, USDC, HOST, GUEST] = ["EVENTS_CONTRACT", "USDC_CONTRACT", "HOST_ACCOUNT", "GUEST_ACCOUNT"].map(env);
const provider = new JsonRpcProvider({ url: process.env.RPC ?? "https://test.rpc.fastnear.com" });
const account = (id) =>
  new Account(id, provider, JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key);
const gas = 100_000_000_000_000n;
const host = account(HOST);
const guest = account(GUEST);

const at = (days, hour, minute = 0) => {
  const d = new Date(Date.now() + days * 24 * 3600_000);
  d.setUTCHours(hour - 8, minute, 0, 0); // Bali is UTC+8
  return d.getTime();
};

const demo = [
  {
    title: "Sunset Run Club · Batu Bolong",
    description: "5 km easy pace along the beach, then coconuts at the end.\n\nEveryone puts down 3 USDC. Show up and you get it back plus a share of the no-shows.",
    location: "Batu Bolong Beach, Canggu",
    starts_at: at(4, 17, 30),
    hours: 2,
    deposit: "3000000",
    capacity: 60,
    guestJoins: true,
  },
  {
    title: "Founders Breakfast · Ubud",
    description: "Ten founders, one long table, honest updates. Small deposit so the seats go to people who come.",
    location: "Ubud, Bali",
    starts_at: at(6, 8, 30),
    hours: 2,
    deposit: "5000000",
    capacity: 12,
    guestJoins: false,
  },
  {
    title: "Beach Clean-up + Smoothies · Uluwatu",
    description: "Bags and gloves provided. We clean for an hour and then hang out.",
    location: "Padang Padang, Uluwatu",
    starts_at: at(8, 9),
    hours: 3,
    deposit: "2000000",
    capacity: 40,
    guestJoins: true,
  },
];

// Safe to re-run: reuses events that already exist and skips guests already in.
const existing = await provider.callFunction({ contractId: EVENTS, method: "get_events", args: {} });
for (const e of demo) {
  const storage = await provider.callFunction({ contractId: EVENTS, method: "storage_cost", args: { capacity: e.capacity } });
  const found = existing.find((x) => x.metadata.title === e.title && x.status === "Open");
  const id = found ? found.id : await host.callFunction({
    contractId: EVENTS,
    methodName: "create_event",
    args: {
      metadata: {
        title: e.title,
        description: e.description,
        location: e.location,
        cover_url: null,
        starts_at: e.starts_at,
        ends_at: e.starts_at + e.hours * 3600_000,
      },
      deposit: e.deposit,
      capacity: e.capacity,
      cohosts: [GUEST],
    },
    deposit: BigInt(storage),
    gas,
  });
  const already = await provider.callFunction({ contractId: EVENTS, method: "get_guest_status", args: { event_id: id, account_id: GUEST } });
  if (e.guestJoins && !already) {
    await guest.callFunction({ contractId: USDC, methodName: "mint", args: { amount: e.deposit }, gas });
    await guest.callFunction({
      contractId: USDC,
      methodName: "ft_transfer_call",
      args: { receiver_id: EVENTS, amount: e.deposit, msg: JSON.stringify({ action: "register", event_id: id }) },
      deposit: 1n,
      gas,
    });
  }
  console.log(id, e.title);
}
