// Deploys the escrow to a fresh sub-account of the deployer, initialises it and
// deletes the account's only key in the same transaction: from then on only the owner can
// change the code (`upgrade`), and nobody can after `freeze`.
// Keys are read from ~/.near-credentials/<NETWORK> (never printed); the new account's key is never saved.
// Env: DEPLOYER, NEW_ACCOUNT (prefix), RELAYER_ACCOUNT, OWNER, WASM, optional NETWORK
// (testnet | mainnet, default testnet), USDC_CONTRACT and INTENTS_CONTRACT (mainnet defaults:
// native USDC and intents.near; testnet: set them, e.g. Tidepool's), NEAR_AMOUNT (default 5).
// Mainnet spends real NEAR, so it also needs CONFIRM_MAINNET=yes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { actions, baseEncode, Account, JsonRpcProvider, KeyPair, parseNearAmount } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const network = process.env.NETWORK ?? "testnet";
const mainnet = network === "mainnet";
if (!["testnet", "mainnet"].includes(network)) throw new Error("NETWORK is testnet or mainnet");
if (mainnet && process.env.CONFIRM_MAINNET !== "yes") throw new Error("Mainnet deploy spends real NEAR: set CONFIRM_MAINNET=yes");
const [DEPLOYER, PREFIX, RELAYER, OWNER, WASM] = ["DEPLOYER", "NEW_ACCOUNT", "RELAYER_ACCOUNT", "OWNER", "WASM"].map(env);
const USDC = process.env.USDC_CONTRACT ?? (mainnet ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : env("USDC_CONTRACT"));
const provider = new JsonRpcProvider({ url: mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com" });
const creds = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/${network}/${id}.json`, "utf8"));
const deployer = new Account(DEPLOYER, provider, creds(DEPLOYER).private_key);

const id = `${PREFIX}.${DEPLOYER}`;
const key = KeyPair.fromRandom("ed25519");
await deployer.createSubAccount({ accountOrPrefix: PREFIX, publicKey: key.getPublicKey().toString(), nearToTransfer: BigInt(parseNearAmount(process.env.NEAR_AMOUNT ?? "5")) });
const contract = new Account(id, provider, key.toString());
const intents = process.env.INTENTS_CONTRACT || (mainnet ? "intents.near" : null);
const wasm = readFileSync(WASM);
const expectedHash = baseEncode(createHash("sha256").update(wasm).digest());
await contract.signAndSendTransaction({
  receiverId: id,
  actions: [
    actions.deployContract(wasm),
    actions.functionCall("new", { usdc: USDC, intents, relayer: RELAYER, owner: OWNER }, 100_000_000_000_000n, 0n),
    actions.deleteKey(key.getPublicKey()),
  ],
  waitUntil: "FINAL",
  throwOnFailure: true,
});
const deployed = await provider.viewAccount({ accountId: id });
if (deployed.code_hash !== expectedHash) throw new Error("Deployed bytecode does not match the input WASM");
const config = await provider.callFunction({ contractId: id, method: "get_config", args: {} });
assert.deepEqual(config, { usdc: USDC, intents, relayer: RELAYER, owner: OWNER, frozen: false, whitelist_mode: false, sponsored_mode: false });
const keys = await provider.viewAccessKeyList({ accountId: id });
assert.equal(keys.keys.length, 0, "The escrow account still has an access key");
// The escrow must hold a USDC storage registration to receive deposits.
await deployer.callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: BigInt(parseNearAmount("0.0125")), gas: 30_000_000_000_000n });
console.log("deployed", id, "on", network, "code", expectedHash, "owner", OWNER, "no access keys");
