// Creates the public demo event on testnet: a Paradise-themed deposit event with
// six registered guests, its public details and guest names, and hides the QA
// events from the public feed (Private = link only; reversible in Manage).
// Keys come from ~/.near-credentials, Upstash from .env.local; nothing secret is printed.
// Run: node --env-file=.env.local scripts/seed-demo.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const EVENTS = process.env.NEXT_PUBLIC_EVENTS_CONTRACT ?? (() => { throw new Error("Set NEXT_PUBLIC_EVENTS_CONTRACT"); })();
const USDC = "usdc.tidepool-sandbox.testnet";
const HOST = "steve-nv1109.testnet";
const GUESTS = { "chawki-nv1109.testnet": "Chawki", "jacqueline-nv1109.testnet": "Jacqueline", "yusak-nv1109.testnet": "Yusak",
  "stan-nv1109.testnet": "Stan", "alexandre-nv1109.testnet": "Alexandre", "hebert-nv1109.testnet": "Hebert" };
const DEPOSIT = "1000000"; // 1 USDC
const TGAS = 1_000_000_000_000n;

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const account = (id) => new Account(id, provider, JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key);
const view = (contractId, method, args) => provider.callFunction({ contractId, method, args });
const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redis = async (command) => {
  const r = await fetch(redisUrl, { method: "POST", headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }, body: JSON.stringify(command) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`Upstash ${command[0]} failed`);
  return j.result;
};
if (!redisUrl) throw new Error("Upstash is not configured");

// Hide every existing event (all QA) from the public feed before adding the demo.
const existing = await view(EVENTS, "get_recent_events", { limit: 100 });
if (existing.length) await redis(["SADD", `event-private:${EVENTS}`, ...existing.map((e) => e.id)]);
for (const id of await redis(["SMEMBERS", `free-events:${EVENTS}`])) {
  const k = `free-event:${EVENTS}:${id}`;
  const e = JSON.parse(await redis(["GET", k]) ?? "null");
  if (e && e.public !== false) await redis(["SET", k, JSON.stringify({ ...e, public: false })]);
}
console.log("hidden", existing.length, "on-chain events and the free test events");

// Thursday 3 December 2026, 18:30 in Bali (UTC+8): still upcoming while judges look.
const starts = Date.UTC(2026, 11, 3, 10, 30);
const id = await account(HOST).callFunction({
  contractId: EVENTS,
  methodName: "create_event",
  args: { metadata: { title: "NEAR Builders Night Bali", starts_at: starts, ends_at: starts + 3 * 3600_000 }, deposit: DEPOSIT, capacity: 40 },
  gas: 100n * TGAS,
});
console.log("demo event", id);

await redis(["SET", `event-details:${EVENTS}:${id}`, JSON.stringify({
  location: "Tropical Nomad Coworking, Jl. Raya Semat No.2, Canggu, Bali",
  description: "An evening for people building on NEAR in Bali. Short demos, open laptops, good food.\n\nPut down 1 USDC when you sign up. Show up and you get it back, plus a share of what the no-shows left behind.",
  cover_url: null,
  public: true,
})]);
await redis(["SET", `event-visual:${EVENTS}:${id}`, JSON.stringify({ themeId: "paradise", seed: 7 })]);

for (const [guest, name] of Object.entries(GUESTS)) {
  const balance = BigInt(await view(USDC, "ft_balance_of", { account_id: guest }));
  if (balance < BigInt(DEPOSIT)) { console.log("skip", guest, "no USDC"); delete GUESTS[guest]; continue; }
  await account(guest).callFunction({
    contractId: USDC, methodName: "ft_transfer_call",
    args: { receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: id }) },
    deposit: 1n, gas: 100n * TGAS,
  });
  console.log(guest, await view(EVENTS, "get_guest_status", { event_id: id, account_id: guest }));
}
await redis(["SET", `guest-names:${EVENTS}:${id}`, JSON.stringify(GUESTS)]);
console.log("done: /e/" + id);
