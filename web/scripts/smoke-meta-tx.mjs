// Meta-transaction smoke through the app (/api/fastauth/fund and /api/fastauth/relay):
// a brand-new implicit account, like a Google/email one, creates a free event and cancels
// it while the relayer pays all the gas; then the relayer registers USDC storage for a
// fresh account. The key is made here and never saved.
// Env: APP_URL (default http://localhost:3000), NETWORK (default testnet), EVENTS_CONTRACT.
// On mainnet this spends a little of the relayer's real NEAR (≈0.01).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { actions, buildDelegateAction, encodeDelegateAction, KeyPair } from "near-api-js";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const mainnet = process.env.NETWORK === "mainnet";
const RPC = mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com";
const EVENTS = process.env.EVENTS_CONTRACT ?? (() => { throw new Error("Set EVENTS_CONTRACT"); })();
const USDC = mainnet ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : "usdc.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function query(params) {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }) }).then((x) => x.json());
  if (r.error || r.result?.error) throw new Error(r.error?.cause?.name ?? r.result.error);
  return r.result;
}
const view = async (contract, method, args) => JSON.parse(Buffer.from((await query({ request_type: "call_function", account_id: contract, method_name: method, args_base64: b64(Buffer.from(JSON.stringify(args))) })).result).toString());
const post = async (path, body) => {
  const res = await fetch(`${APP}${path}`, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

const key = KeyPair.fromRandom("ed25519");
const publicKey = key.getPublicKey();
const account = Buffer.from(publicKey.data).toString("hex");
console.log("implicit account", account);

const funded = await post("/api/fastauth/fund", { accountId: account });
assert.equal(funded.status, 200, JSON.stringify(funded.json));
let before;
for (let i = 0; i < 20 && !before; i++) before = await query({ request_type: "view_account", account_id: account }).catch(() => sleep(1500));
assert.ok(before, "the account was not created");
console.log("activated with", before.amount, "yoctoNEAR");

async function delegate(receiverId, methodName, args, deposit = 0n) {
  const ak = await query({ request_type: "view_access_key", account_id: account, public_key: publicKey.toString() });
  const d = buildDelegateAction({
    senderId: account, receiverId, actions: [actions.functionCall(methodName, args, 100n * TGAS, deposit)],
    nonce: BigInt(ak.nonce) + 1n, maxBlockHeight: BigInt(ak.block_height) + 600n, publicKey,
  });
  const bytes = encodeDelegateAction(d);
  return { bytes, signature: key.sign(createHash("sha256").update(bytes).digest()).signature };
}
const relay = ({ bytes, signature }) => post("/api/fastauth/relay", { delegate: b64(bytes), signature: b64(signature) });

// Refused before any gas is spent.
const forged = await delegate(EVENTS, "cancel", { event_id: 0 }, 1n);
forged.signature = new Uint8Array(64);
assert.equal((await relay(forged)).status, 401, "a bad signature must be refused");
assert.equal((await relay(await delegate("wrap.near", "near_deposit", {}, 1n))).status, 400, "other contracts must be refused");

const now = Date.now();
const created = await relay(await delegate(EVENTS, "create_event", { metadata: { title: "meta-tx smoke", starts_at: now, ends_at: now + 3600_000 }, deposit: "100000", capacity: 10 }));
assert.equal(created.status, 200, JSON.stringify(created.json));
console.log("create_event", created.json.hash);
let mine;
for (let i = 0; i < 10 && !mine; i++) {
  mine = (await view(EVENTS, "get_recent_events", { limit: 20 })).find((e) => e.host === account);
  if (!mine) await sleep(1500);
}
assert.ok(mine, "the event is not on chain");
const cancelled = await relay(await delegate(EVENTS, "cancel", { event_id: mine.id }, 1n));
assert.equal(cancelled.status, 200, JSON.stringify(cancelled.json));
console.log("cancel event", mine.id, cancelled.json.hash);
let status;
for (let i = 0; i < 10 && status !== "Cancelled"; i++) {
  status = (await view(EVENTS, "get_event", { event_id: mine.id })).status;
  if (status !== "Cancelled") await sleep(1500);
}
assert.equal(status, "Cancelled");

const after = await query({ request_type: "view_account", account_id: account });
// Only the 1 yoctoNEAR deposit left the account: the relayer paid every gas unit.
assert.equal(BigInt(before.amount) - BigInt(after.amount), 1n, `balance moved by ${BigInt(before.amount) - BigInt(after.amount)}`);
console.log("account paid no gas");

const stranger = Buffer.from(KeyPair.fromRandom("ed25519").getPublicKey().data).toString("hex");
const storage = await post("/api/fastauth/relay", { storageFor: stranger });
assert.equal(storage.status, 200, JSON.stringify(storage.json));
for (let i = 0; i < 10 && !(await view(USDC, "storage_balance_of", { account_id: stranger })); i++) await sleep(1500);
assert.ok(await view(USDC, "storage_balance_of", { account_id: stranger }), "USDC storage not registered");
console.log("relayer registered USDC storage for", stranger);
console.log("meta-tx smoke passed");
