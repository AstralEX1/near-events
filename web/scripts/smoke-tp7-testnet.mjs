// Testnet check of the tp7 escrow rules with real transactions: the 60-day free
// tier, the refund of empty paid seats, the host whitelist (direct and through a
// NEAR Intents `auth_call` signed by the owner), an EVM host creating and closing
// an event through `auth_call`, an Intents registration whose duplicate is
// refunded by the verifier, a relayed payout, and an owner upgrade.
// Keys come from ~/.near-credentials/testnet (never printed).
// Env: EVENTS_CONTRACT, OWNER, HOST_ACCOUNT, GUEST_ACCOUNT, RELAYER_ACCOUNT, WASM,
// optional APP_URL (relay EVM host actions through the app's /api/intents/execute).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Account, JsonRpcProvider, KeyPair, baseEncode } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [EVENTS, OWNER, HOST, GUEST, RELAYER, WASM] = ["EVENTS_CONTRACT", "OWNER", "HOST_ACCOUNT", "GUEST_ACCOUNT", "RELAYER_ACCOUNT", "WASM"].map(env);
const APP = process.env.APP_URL;
const USDC = "usdc.tidepool-sandbox.testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;
const BYTE = 10n ** 19n; // yoctoNEAR per byte of storage
const SEAT_BYTES = 560n;
const DEPOSIT = "100000"; // 0.1 USDC
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const secret = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
const [owner, host, guest, relayer] = [OWNER, HOST, GUEST, RELAYER].map((id) => new Account(id, provider, secret(id)));
const view = (method, args = {}, contractId = EVENTS) => provider.callFunction({ contractId, method, args });
const raw = (who, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
const logs = (outcome) => outcome.receipts_outcome.flatMap((r) => r.outcome.logs);
const failure = (outcome) => JSON.stringify(outcome.receipts_outcome.map((r) => r.outcome.status.Failure).filter(Boolean));
const value = (outcome) => JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString());
const step = (n, text) => console.log(`${n}. ${text}`);
async function rejects(promise, needle) {
  const outcome = await promise.catch((e) => ({ thrown: String(e?.message ?? e) }));
  const text = outcome.thrown ?? failure(outcome);
  assert.ok(text.includes(needle), `expected "${needle}", got ${text.slice(0, 300)}`);
}
const meta = (title, endsInMs) => {
  const now = Date.now();
  return { title, starts_at: now, ends_at: now + endsInMs };
};
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// 0. The guest needs a little test USDC.
if (BigInt(await view("ft_balance_of", { account_id: GUEST }, USDC)) < 500_000n) {
  await raw(relayer, USDC, "ft_transfer", { receiver_id: GUEST, amount: "1000000" }, 1n, 30n * TGAS);
}
const config = await view("get_config");
assert.equal(config.owner, OWNER);
assert.equal((await provider.viewAccessKeyList({ accountId: EVENTS })).keys.length, 0);
step(0, `config ok, no access keys, owner ${OWNER}`);

// 1. Free tier: within 60 days free, beyond that the host pays.
const freeId = await host.callFunction({ contractId: EVENTS, methodName: "create_event", args: { metadata: meta("tp7 smoke free", HOUR), deposit: DEPOSIT, capacity: 10 }, gas: 30n * TGAS });
const late = meta("tp7 smoke late", 61 * DAY);
assert.ok(BigInt(await view("create_event_cost", { host: HOST, capacity: 10, ends_at: late.ends_at })) > 0n);
await rejects(raw(host, EVENTS, "create_event", { metadata: late, deposit: DEPOSIT, capacity: 10 }), "ending within 60 days");
step(1, `free event ${freeId} created; a free event ending in 61 days is refused`);

// 2. A paid event gets its empty seats back at close.
const cost = BigInt(await view("create_event_cost", { host: HOST, capacity: 51 }));
const paidId = value(await raw(host, EVENTS, "create_event", { metadata: meta("tp7 smoke paid", HOUR), deposit: DEPOSIT, capacity: 51 }, cost, 30n * TGAS));
await raw(guest, USDC, "ft_transfer_call", { receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: paidId }) }, 1n, 100n * TGAS);
assert.equal(await view("get_guest_status", { event_id: paidId, account_id: GUEST }), "Registered");
const cancelled = await raw(host, EVENTS, "cancel", { event_id: paidId }, 1n, 100n * TGAS);
const refundLog = logs(cancelled).find((l) => l.includes('"storage_refund"'));
assert.ok(refundLog, "no storage_refund log");
const refund = BigInt(JSON.parse(refundLog.slice("EVENT_JSON:".length)).data[0].amount);
assert.equal(refund, SEAT_BYTES * 50n * BYTE);
step(2, `paid event ${paidId}: host paid ${cost} yocto, got ${refund} back for 50 empty seats`);

// 3. Whitelist mode: only listed hosts get the free tier.
await raw(owner, EVENTS, "set_whitelist_mode", { enabled: true }, 1n, 30n * TGAS);
await rejects(raw(host, EVENTS, "create_event", { metadata: meta("tp7 smoke unlisted", HOUR), deposit: DEPOSIT, capacity: 10 }), "whitelisted hosts");
await raw(owner, EVENTS, "add_to_whitelist", { accounts: [HOST] }, 1n, 30n * TGAS);
const listedId = await host.callFunction({ contractId: EVENTS, methodName: "create_event", args: { metadata: meta("tp7 smoke listed", HOUR), deposit: DEPOSIT, capacity: 10 }, gas: 30n * TGAS });
await raw(owner, EVENTS, "remove_from_whitelist", { accounts: [HOST] }, 1n, 30n * TGAS);
await rejects(raw(host, EVENTS, "set_whitelist_mode", { enabled: false }, 1n, 30n * TGAS), "Only the owner");
step(3, `whitelist on: unlisted host refused, listed host created event ${listedId}, stranger cannot switch the mode`);

// 4. The owner runs the whitelist through a NEAR Intents auth_call (NEP-413).
const salt = await view("current_salt", {}, VERIFIER);
const freshNonce = () => {
  const nonce = Buffer.alloc(32);
  Buffer.from(salt, "hex").copy(nonce);
  crypto.getRandomValues(nonce.subarray(4));
  return nonce;
};
const deadline = () => new Date(Date.now() + 5 * 60_000).toISOString();
const ownerKey = KeyPair.fromString(secret(OWNER));
const ownerPublic = ownerKey.getPublicKey().toString();
if (!await view("has_public_key", { account_id: OWNER, public_key: ownerPublic }, VERIFIER).catch(() => false)) {
  await raw(owner, VERIFIER, "add_public_key", { public_key: ownerPublic }, 1n, 100n * TGAS);
}
const borshString = (s) => {
  const bytes = Buffer.from(s);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};
function nep413(keyPair, signerId, intents) {
  const message = JSON.stringify({ deadline: deadline(), intents, signer_id: signerId });
  const nonce = freshNonce();
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  const hash = createHash("sha256").update(Buffer.concat([tag, borshString(message), nonce, borshString(VERIFIER), Buffer.from([0])])).digest();
  return {
    standard: "nep413",
    payload: { recipient: VERIFIER, nonce: nonce.toString("base64"), message },
    public_key: keyPair.getPublicKey().toString(),
    signature: `ed25519:${baseEncode(keyPair.sign(hash).signature)}`,
  };
}
const authCall = (msg) => ({ intent: "auth_call", contract_id: EVENTS, msg: JSON.stringify(msg) });
const ownerIntent = nep413(ownerKey, OWNER, [authCall({ action: "add_to_whitelist", accounts: [HOST] })]);
await raw(owner, VERIFIER, "execute_intents", { signed: [ownerIntent] }, 0n, 300n * TGAS);
assert.equal(await view("is_whitelisted", { account_id: HOST }), true);
await raw(owner, EVENTS, "remove_from_whitelist", { accounts: [HOST] }, 1n, 30n * TGAS);
await raw(owner, EVENTS, "set_whitelist_mode", { enabled: false }, 1n, 30n * TGAS);
step(4, "owner added a host through a signed Intents auth_call; mode back off");

// 5. An EVM wallet hosts and closes an event through auth_call (ERC-191).
const evm = () => {
  const { secretKey } = secp256k1.keygen();
  const pub = secp256k1.getPublicKey(secretKey, false);
  return { secretKey, id: `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString("hex")}` };
};
function erc191(wallet, intents) {
  const payload = JSON.stringify({
    signer_id: wallet.id, verifying_contract: VERIFIER, deadline: deadline(), nonce: freshNonce().toString("base64"), intents,
  });
  const bytes = Buffer.from(payload);
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
  const recovered = secp256k1.sign(digest, wallet.secretKey, { prehash: false, format: "recovered" });
  const signature = Buffer.concat([recovered.subarray(1), recovered.subarray(0, 1)]);
  return { standard: "erc191", payload, signature: `secp256k1:${baseEncode(signature)}` };
}
async function relay(signed) {
  if (!APP) return raw(relayer, VERIFIER, "execute_intents", { signed: [signed] }, 0n, 300n * TGAS);
  const response = await fetch(new URL("/api/intents/execute", APP), { method: "POST", body: JSON.stringify(signed), signal: AbortSignal.timeout(90_000) });
  const json = await response.json();
  assert.ok(response.ok, `relay failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
const evmHost = evm();
await relay(erc191(evmHost, [authCall({ action: "create_event", metadata: meta("tp7 smoke EVM host", HOUR), deposit: DEPOSIT, capacity: 10 })]));
const evmEvent = (await view("get_recent_events", { limit: 5 })).find((e) => e.host === evmHost.id);
assert.ok(evmEvent, "the EVM host's event was not created");
await raw(guest, USDC, "ft_transfer_call", { receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: evmEvent.id }) }, 1n, 100n * TGAS);
const before = BigInt(await view("balance_of", { account_id: GUEST }));
await relay(erc191(evmHost, [authCall({ action: "finalize", event_id: evmEvent.id, attended: [GUEST] })]));
assert.equal((await view("get_event", { event_id: evmEvent.id })).status, "Finalized");
assert.equal(BigInt(await view("balance_of", { account_id: GUEST })) - before, BigInt(DEPOSIT));
step(5, `EVM host ${evmHost.id.slice(0, 10)}… created event ${evmEvent.id} and closed it through auth_call${APP ? " via the app relayer" : ""}`);

// 6. An Intents registration; the duplicate comes back to the guest's Intents balance.
const evmGuest = evm();
const tokenId = `nep141:${USDC}`;
await raw(relayer, USDC, "ft_transfer_call", { receiver_id: VERIFIER, amount: String(2n * BigInt(DEPOSIT)), msg: evmGuest.id }, 1n, 100n * TGAS);
const register = () => erc191(evmGuest, [{ intent: "ft_withdraw", token: USDC, receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: freeId, guest: evmGuest.id }) }]);
await raw(relayer, VERIFIER, "execute_intents", { signed: [register()] }, 0n, 300n * TGAS);
assert.equal(await view("get_guest_status", { event_id: freeId, account_id: evmGuest.id }), "Registered");
await raw(relayer, VERIFIER, "execute_intents", { signed: [register()] }, 0n, 300n * TGAS);
assert.equal(await view("mt_balance_of", { account_id: evmGuest.id, token_id: tokenId }, VERIFIER), DEPOSIT);
await raw(host, EVENTS, "cancel", { event_id: freeId }, 1n, 100n * TGAS);
const payout = value(await raw(relayer, EVENTS, "payout_to_intents", { account_id: evmGuest.id, amount: DEPOSIT }, 0n, 200n * TGAS));
assert.equal(payout, DEPOSIT);
assert.equal(await view("mt_balance_of", { account_id: evmGuest.id, token_id: tokenId }, VERIFIER), String(2n * BigInt(DEPOSIT)));
step(6, "Intents registration ok, duplicate refunded to Intents, relayed payout after cancel ok");

// 7. The owner upgrades the code (same WASM here); state stays.
const eventsBefore = (await view("get_recent_events", { limit: 100 })).length;
await rejects(raw(host, EVENTS, "upgrade", new Uint8Array(readFileSync(WASM)), 1n, 300n * TGAS), "Only the owner");
const upgraded = await raw(owner, EVENTS, "upgrade", new Uint8Array(readFileSync(WASM)), 1n, 300n * TGAS);
assert.equal(failure(upgraded), "[]", `upgrade failed: ${failure(upgraded)}`);
assert.equal((await view("get_recent_events", { limit: 100 })).length, eventsBefore);
assert.equal((await view("get_config")).frozen, false);
step(7, `owner upgrade ok (${upgraded.transaction.hash}), ${eventsBefore} events kept`);

for (const id of [listedId]) await raw(host, EVENTS, "cancel", { event_id: id }, 1n, 100n * TGAS);
console.log("tp7 testnet smoke passed");
