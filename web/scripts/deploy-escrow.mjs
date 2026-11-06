// Deploys the escrow to a fresh testnet sub-account of the deployer and initialises it.
// Keys are read from ~/.near-credentials (never printed); the new account's key is saved there too.
// Env: DEPLOYER, NEW_ACCOUNT (prefix), USDC_CONTRACT, RELAYER_ACCOUNT, WASM,
// optional INTENTS_CONTRACT (e.g. verifier.tidepool-sandbox.testnet) and NEAR_AMOUNT (default 5)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { actions, baseEncode, Account, JsonRpcProvider, KeyPair, parseNearAmount } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [DEPLOYER, PREFIX, USDC, RELAYER, WASM] = ["DEPLOYER", "NEW_ACCOUNT", "USDC_CONTRACT", "RELAYER_ACCOUNT", "WASM"].map(env);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const creds = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8"));
const deployer = new Account(DEPLOYER, provider, creds(DEPLOYER).private_key);

const id = `${PREFIX}.${DEPLOYER}`;
const key = KeyPair.fromRandom("ed25519");
await deployer.createSubAccount({ accountOrPrefix: PREFIX, publicKey: key.getPublicKey().toString(), nearToTransfer: BigInt(parseNearAmount(process.env.NEAR_AMOUNT ?? "5")) });
writeFileSync(
  `${homedir()}/.near-credentials/testnet/${id}.json`,
  JSON.stringify({ account_id: id, public_key: key.getPublicKey().toString(), private_key: key.toString() }),
  { mode: 0o600 },
);
const contract = new Account(id, provider, key.toString());
const intents = process.env.INTENTS_CONTRACT || null;
const wasm = readFileSync(WASM);
const expectedHash = baseEncode(createHash("sha256").update(wasm).digest());
await contract.signAndSendTransaction({
  receiverId: id,
  actions: [
    actions.deployContract(wasm),
    actions.functionCall("new", { usdc: USDC, intents, relayer: RELAYER }, 100_000_000_000_000n, 0n),
  ],
  waitUntil: "FINAL",
  throwOnFailure: true,
});
const deployed = await provider.viewAccount({ accountId: id });
if (deployed.code_hash !== expectedHash) throw new Error("Deployed bytecode does not match the input WASM");
for (const [method, expected] of Object.entries({ usdc: USDC, intents, relayer: RELAYER })) {
  const actual = await provider.callFunction({ contractId: id, method, args: {} });
  if (actual !== expected) throw new Error(`Unexpected contract configuration: ${method}`);
}
// The escrow must hold a USDC storage registration to receive deposits.
await deployer.callFunction({ contractId: USDC, methodName: "storage_deposit", args: { account_id: id, registration_only: true }, deposit: BigInt(parseNearAmount("0.0125")), gas: 30_000_000_000_000n });
console.log("deployed", id);
