// Deploys the escrow to a fresh testnet sub-account of the deployer and initialises it.
// Keys are read from ~/.near-credentials (never printed); the new account's key is saved there too.
// Env: DEPLOYER, NEW_ACCOUNT (prefix), USDC_CONTRACT, RELAYER_ACCOUNT, WASM
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider, KeyPair, parseNearAmount } from "near-api-js";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [DEPLOYER, PREFIX, USDC, RELAYER, WASM] = ["DEPLOYER", "NEW_ACCOUNT", "USDC_CONTRACT", "RELAYER_ACCOUNT", "WASM"].map(env);
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const creds = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8"));
const deployer = new Account(DEPLOYER, provider, creds(DEPLOYER).private_key);

const id = `${PREFIX}.${DEPLOYER}`;
const key = KeyPair.fromRandom("ed25519");
await deployer.createSubAccount({ accountOrPrefix: PREFIX, publicKey: key.getPublicKey().toString(), nearToTransfer: BigInt(parseNearAmount("5")) });
writeFileSync(
  `${homedir()}/.near-credentials/testnet/${id}.json`,
  JSON.stringify({ account_id: id, public_key: key.getPublicKey().toString(), private_key: key.toString() }),
  { mode: 0o600 },
);
const contract = new Account(id, provider, key.toString());
await contract.deployContract(new Uint8Array(readFileSync(WASM)));
await contract.callFunction({ contractId: id, methodName: "new", args: { usdc: USDC, intents: null, relayer: RELAYER }, gas: 100_000_000_000_000n });
console.log("deployed", id);
