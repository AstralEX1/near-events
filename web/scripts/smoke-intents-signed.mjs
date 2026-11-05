// Testnet check of the Intents-native deposit (what EVM wallets use): the
// guest's USDC sits in NEAR Intents (Tidepool verifier), the guest signs one
// `ft_withdraw` intent to the escrow with a register msg, and the verifier's
// ft_transfer_call registers them. Uses a throwaway raw_ed25519 implicit
// account as the guest, so no wallet is needed. Keys never printed.
// Env: EVENTS_CONTRACT, HOST_ACCOUNT, FUNDER_ACCOUNT (pays gas and the 1 USDC).
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider, KeyPair, parseNearAmount } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
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

const kp = KeyPair.fromRandom("ed25519");
const pub = kp.getPublicKey();
const guest = Buffer.from(pub.data).toString("hex");
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
const { signature } = kp.sign(new TextEncoder().encode(payload));
const { baseEncode } = await import("near-api-js");
const signed = { standard: "raw_ed25519", payload, public_key: pub.toString(), signature: `ed25519:${baseEncode(signature)}` };
await call(funder, VERIFIER, "execute_intents", { signed: [signed] }, 0n, 300n * TGAS);
console.log("3. guest status", await view("get_guest_status", { event_id: eventId, account_id: guest }));
await call(host, EVENTS, "cancel", { event_id: eventId }, 1n, 300n * TGAS);
console.log("4. cancelled, refund on guest balance", await view("balance_of", { account_id: guest }));
