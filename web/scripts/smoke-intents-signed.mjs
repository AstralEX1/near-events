// Testnet check of the Intents-native deposit (what EVM wallets use): the
// guest's USDC sits in NEAR Intents (Tidepool verifier), the guest signs one
// `ft_withdraw` intent to the escrow with a register msg, and the verifier's
// ft_transfer_call registers them. A throwaway EVM key signs ERC-191 and the
// app relayer submits it. Env: EVENTS_CONTRACT, HOST_ACCOUNT, FUNDER_ACCOUNT, APP_URL.
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider, baseEncode } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
const APP = env("APP_URL");
const HOST = env("HOST_ACCOUNT");
const FUNDER = env("FUNDER_ACCOUNT");
const USDC = "usdc.tidepool-sandbox.testnet";
const VERIFIER = "verifier.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const key = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
const host = new Account(HOST, provider, key(HOST));
const funder = new Account(FUNDER, provider, key(FUNDER));
const view = (method, args = {}, contractId = EVENTS) => provider.callFunction({ contractId, method, args });
const call = (who, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) => who.callFunction({ contractId, methodName, args, deposit, gas });

const { secretKey } = secp256k1.keygen();
const pub = secp256k1.getPublicKey(secretKey, false);
const guest = `0x${Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString("hex")}`;
const DEPOSIT = "1000000";

const now = Date.now();
const eventId = await call(host, EVENTS, "create_event", {
  metadata: { title: "Signed intent smoke test", description: "Automated Tidepool run", location: "Online", cover_url: null, starts_at: now, ends_at: now + 3600_000 },
  deposit: DEPOSIT, capacity: 5, cohosts: null,
});
console.log("1. event", eventId, "guest", guest.slice(0, 10) + "…");

// Fund the guest's Intents balance: a deposit into the verifier credits the account named in msg.
await call(funder, USDC, "ft_transfer_call", { receiver_id: VERIFIER, amount: DEPOSIT, msg: guest }, 1n, 100n * TGAS);
console.log("2. guest Intents USDC", await view("mt_balance_of", { account_id: guest, token_id: `nep141:${USDC}` }, VERIFIER));

const salt = await view("current_salt", {}, VERIFIER);
const nonce = Buffer.alloc(32);
Buffer.from(salt, "hex").copy(nonce);
crypto.getRandomValues(nonce.subarray(4));
const payload = JSON.stringify({
  signer_id: guest,
  verifying_contract: VERIFIER,
  deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
  nonce: nonce.toString("base64"),
  intents: [{ intent: "ft_withdraw", token: USDC, receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: eventId, guest }) }],
});
const bytes = Buffer.from(payload);
const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
const recovered = secp256k1.sign(digest, secretKey, { prehash: false, format: "recovered" });
const signature = Buffer.concat([recovered.subarray(1), recovered.subarray(0, 1)]);
const response = await fetch(new URL("/api/intents/execute", APP), {
  method: "POST", body: JSON.stringify({ standard: "erc191", payload, signature: `secp256k1:${baseEncode(signature)}` }),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) throw new Error(`Relayer rejected ERC-191: HTTP ${response.status}`);
for (let i = 0; i < 12; i++) {
  if (await view("get_guest_status", { event_id: eventId, account_id: guest }) === "Registered") break;
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
assert.equal(await view("get_guest_status", { event_id: eventId, account_id: guest }), "Registered");
await call(host, EVENTS, "cancel", { event_id: eventId }, 1n, 300n * TGAS);
assert.equal(await view("balance_of", { account_id: guest }), DEPOSIT);
const payout = await fetch(new URL("/api/intents/payout", APP), {
  method: "POST", body: JSON.stringify({ accountId: guest, amount: DEPOSIT }), signal: AbortSignal.timeout(60_000),
});
assert.ok(payout.ok, `Payout API failed: ${payout.status}`);
assert.equal((await payout.json()).sent, DEPOSIT);
assert.equal(await view("mt_balance_of", { account_id: guest, token_id: `nep141:${USDC}` }, VERIFIER), DEPOSIT);
console.log("ERC-191 registration and relayed refund passed");
