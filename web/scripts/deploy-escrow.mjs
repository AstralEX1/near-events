// Deploys the escrow to a fresh sub-account of the deployer, initialises it and
// deletes the account's only key in the same transaction: from then on only the owner can
// change the code (`upgrade`), and nobody can after `freeze`.
// The deployer key comes from ~/.near-credentials/<NETWORK>/<DEPLOYER>.json or, if there is
// no such file, from a hidden prompt (private key or seed phrase; never printed or saved).
// Env (asked for when missing): DEPLOYER, RELAYER_ACCOUNT, NEAR_AMOUNT. Required: WASM.
// Optional: OWNER (default: DEPLOYER), NEW_ACCOUNT (prefix, default "escrow"), NETWORK
// (testnet | mainnet, default testnet), USDC_CONTRACT and INTENTS_CONTRACT (mainnet defaults:
// native USDC and intents.near; testnet: set them, e.g. Tidepool's).
// Nothing is sent before read-only checks pass; mainnet also needs CONFIRM_MAINNET=yes and a typed "yes".
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { actions, baseEncode, Account, JsonRpcProvider, KeyPair, parseNearAmount } from "near-api-js";
import { accountKey, ask, closePrompts, credPath as cred, fail } from "./keyPrompt.mjs";

const network = process.env.NETWORK ?? "testnet";
const mainnet = network === "mainnet";
if (!["testnet", "mainnet"].includes(network)) fail("NETWORK is testnet or mainnet");
if (mainnet && process.env.CONFIRM_MAINNET !== "yes") fail("Mainnet deploy spends real NEAR: set CONFIRM_MAINNET=yes");
const WASM = process.env.WASM || fail("Set WASM to the escrow-wasm artifact (near_events.wasm)");
const wasm = readFileSync(WASM);

const DEPLOYER = process.env.DEPLOYER || await ask("Deployer account (also the owner): ");
const RELAYER = process.env.RELAYER_ACCOUNT || await ask("Relayer account: ");
const OWNER = process.env.OWNER || DEPLOYER;
const id = `${process.env.NEW_ACCOUNT || "escrow"}.${DEPLOYER}`;
const USDC = process.env.USDC_CONTRACT ?? (mainnet ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : fail("Set USDC_CONTRACT"));
const intents = process.env.INTENTS_CONTRACT || (mainnet ? "intents.near" : null);
const provider = new JsonRpcProvider({ url: mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com" });
const credPath = (account) => cred(network, account);

// ---------------------------------------------------------------- read-only checks
const show = (yocto) => (Number(yocto) / 1e24).toFixed(4);
const viewAccount = (accountId) => provider.viewAccount({ accountId }).catch((e) => {
  if (/does not exist/i.test(e.message)) return null;
  throw e;
});
if (!DEPLOYER || !RELAYER) fail("Deployer and relayer accounts are required");
if (/^([0-9a-f]{64}|0x[0-9a-f]{40})$/.test(DEPLOYER)) fail(`${DEPLOYER} is an implicit account; the escrow is a sub-account, so the deployer needs a name like alice.near`);
const deployerState = await viewAccount(DEPLOYER) ?? fail(`${DEPLOYER} does not exist on ${network}`);
for (const account of new Set([RELAYER, OWNER])) if (!(await viewAccount(account))) fail(`${account} does not exist on ${network}: check the spelling, it is written into the contract for good`);
if (await viewAccount(id)) fail(`${id} already exists; pick another NEW_ACCOUNT`);

const deployerKey = await accountKey(provider, network, DEPLOYER);

// Storage costs 1e19 yocto per byte; 2 KB covers the account and the initial state.
const minStake = BigInt(wasm.length + 2000) * 10n ** 19n;
const reserve = BigInt(parseNearAmount("0.1")) + BigInt(deployerState.storage_usage) * 10n ** 19n; // gas, USDC registration, deployer's own storage
const spendable = deployerState.amount - reserve;
if (spendable < minStake) fail(`${DEPLOYER} has ${show(deployerState.amount)} NEAR; the code alone needs ${show(minStake)} NEAR in the escrow. Top up to at least ${show(minStake + reserve)} NEAR.`);
const suggested = spendable < BigInt(parseNearAmount("8")) ? spendable / 10n ** 22n * 10n ** 22n : BigInt(parseNearAmount("8"));
const amountText = process.env.NEAR_AMOUNT || await ask(`NEAR to put into the escrow (code ${show(minStake)}, the rest is the free-tier pool) [${show(suggested)}]: `) || show(suggested);
const amount = BigInt(parseNearAmount(amountText) ?? fail("Bad NEAR amount"));
if (amount < minStake) fail(`At least ${show(minStake)} NEAR is needed for the code`);
if (amount > spendable) fail(`${DEPLOYER} can spend at most ${show(spendable)} NEAR here`);

console.log(`\n${network}: create ${id} with ${show(amount)} NEAR from ${DEPLOYER}
  owner ${OWNER}, relayer ${RELAYER}, USDC ${USDC}, intents ${intents}
  code ${WASM} (${wasm.length} bytes, hash ${baseEncode(createHash("sha256").update(wasm).digest())})`);
if (mainnet && (await ask('Type "yes" to deploy with real NEAR: ')) !== "yes") fail("Cancelled; nothing was sent.");
closePrompts();

// ---------------------------------------------------------------- deploy
const deployer = new Account(DEPLOYER, provider, deployerKey.toString());
const key = KeyPair.fromRandom("ed25519");
// Kept (mode 600) only until the key is deleted on chain, so an interrupted run can still recover the NEAR.
mkdirSync(dirname(credPath(id)), { recursive: true });
writeFileSync(credPath(id), JSON.stringify({ account_id: id, public_key: key.getPublicKey().toString(), private_key: key.toString() }), { mode: 0o600 });
await deployer.createSubAccount({ accountOrPrefix: id, publicKey: key.getPublicKey().toString(), nearToTransfer: amount });
const contract = new Account(id, provider, key.toString());
const expectedHash = baseEncode(createHash("sha256").update(wasm).digest());
try {
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
} catch (e) {
  console.error("Deploy failed:", e.message);
  await contract.deleteAccount(DEPLOYER);
  unlinkSync(credPath(id));
  fail(`${id} was deleted and its NEAR returned to ${DEPLOYER}; nothing is deployed.`);
}
unlinkSync(credPath(id));
const deployed = await provider.viewAccount({ accountId: id });
if (deployed.code_hash !== expectedHash) throw new Error("Deployed bytecode does not match the input WASM");
const config = await provider.callFunction({ contractId: id, method: "get_config", args: {} });
assert.deepEqual(config, { usdc: USDC, intents, relayer: RELAYER, owner: OWNER, frozen: false, whitelist_mode: false, sponsored_mode: false });
const keys = await provider.viewAccessKeyList({ accountId: id });
assert.equal(keys.keys.length, 0, "The escrow account still has an access key");
// The escrow must hold a USDC storage registration to receive deposits.
await deployer.callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: BigInt(parseNearAmount("0.0125")), gas: 30_000_000_000_000n });
console.log("deployed", id, "on", network, "code", expectedHash, "owner", OWNER, "relayer", RELAYER, "no access keys");
