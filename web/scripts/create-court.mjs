// Creates the escrow v3 court: a Sputnik DAO whose council of 5 settles disputes with 3 votes and
// whose `dispute_bot` (the relayer) may only propose. Policy: docs/oracle-upgrade/evidence/
// dao-init-args.example.json with the council swapped in (DEPLOY.md, Later: a court, step 3).
// When the creator is on the council it also proposes turning off the factory's code auto-update;
// 3 council votes approve it (sputnik-dao.trezu.org), then check-release.mjs passes the court.
// The creator's key comes from ~/.near-credentials/<NETWORK>/<CREATOR>.json or a hidden prompt
// (private key or seed phrase; never printed or saved). Mainnet asks for a typed "yes".
// Env: CREATOR, COUNCIL (5 accounts, comma-separated), optional NETWORK (testnet | mainnet),
// NAME (default nearvent-court), DEPOSIT in NEAR (default 1 on mainnet, where the DAO code is a
// global contract; 6 on testnet, where the 555 KB code is stored on the account).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider, parseNearAmount } from "near-api-js";
import { accountKey, ask, closePrompts, fail } from "./keyPrompt.mjs";

const network = process.env.NETWORK ?? "testnet";
const mainnet = network === "mainnet";
const FACTORY = mainnet ? "sputnik-dao.near" : "sputnikv2.testnet";
const BOT = mainnet ? "event_relayer.near" : "relayer-nearevents-11022103.testnet";
const NAME = process.env.NAME ?? "nearvent-court";
const CREATOR = process.env.CREATOR;
const COUNCIL = (process.env.COUNCIL ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!CREATOR || !/^[a-z0-9-]{2,40}$/.test(NAME) || COUNCIL.length !== 5 || new Set(COUNCIL).size !== 5) fail("Set CREATOR and COUNCIL (5 different accounts); NAME is a-z, 0-9, -");
if (COUNCIL.includes(BOT)) fail(`${BOT} is the dispute bot; it cannot sit on the council`);
const DAO = `${NAME}.${FACTORY}`;
const deposit = BigInt(parseNearAmount(process.env.DEPOSIT ?? (mainnet ? "1" : "6")) ?? fail("Bad DEPOSIT"));
const provider = new JsonRpcProvider({ url: mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com" });
const TGAS = 1_000_000_000_000n;

for (const id of COUNCIL) await provider.viewAccount({ accountId: id }).catch((e) => fail(`${id} on ${network}: ${e.message}`));
if (await provider.viewAccount({ accountId: DAO }).catch(() => null)) fail(`${DAO} already exists`);

const init = JSON.parse(readFileSync(new URL("../../docs/oracle-upgrade/evidence/dao-init-args.example.json", import.meta.url), "utf8"));
const role = (name) => init.policy.roles.find((r) => r.name === name) ?? fail(`No ${name} role in the init args`);
role("council").kind.Group = COUNCIL;
role("dispute_bot").kind.Group = [BOT];
init.config.name = NAME;

const creator = new Account(CREATOR, provider, (await accountKey(provider, network, CREATOR)).toString());
console.log(`${network}: create ${DAO} from ${CREATOR} with ${(Number(deposit) / 1e24).toFixed(2)} NEAR\n  council (3 of 5): ${COUNCIL.join(", ")}\n  dispute bot (proposes only): ${BOT}`);
if (mainnet && (await ask('Type "yes" to send: ')) !== "yes") fail("Cancelled; nothing was sent.");
closePrompts();

const args = Buffer.from(JSON.stringify(init)).toString("base64");
const created = await creator.callFunctionRaw({ contractId: FACTORY, methodName: "create", args: { name: NAME, args }, deposit, gas: 300n * TGAS, waitUntil: "FINAL" });
const failed = created.receipts_outcome.map((r) => r.outcome.status.Failure).filter(Boolean);
if (failed.length) fail(`Create failed (the deposit comes back): ${JSON.stringify(failed)}`);
const policy = await provider.callFunction({ contractId: DAO, method: "get_policy", args: {} });
assert.deepEqual(policy.roles.find((r) => r.name === "council").kind.Group.sort(), [...COUNCIL].sort());
assert.deepEqual(policy.roles.find((r) => r.name === "dispute_bot").kind.Group, [BOT]);
console.log("created", DAO, "tx", created.transaction.hash);

if (COUNCIL.includes(CREATOR)) {
  const proposed = await creator.callFunctionRaw({
    contractId: DAO, methodName: "add_proposal", deposit: BigInt(policy.proposal_bond), gas: 100n * TGAS, waitUntil: "FINAL",
    args: { proposal: { description: "Turn off the factory's code auto-update", kind: { FactoryInfoUpdate: { factory_info: { factory_id: FACTORY, auto_update: false } } } } },
  });
  const id = JSON.parse(Buffer.from(proposed.status.SuccessValue, "base64").toString());
  console.log(`proposal ${id}: auto_update off; 3 council votes approve it.`);
} else console.log(`A council member proposes FactoryInfoUpdate {factory_id: "${FACTORY}", auto_update: false}; 3 votes approve it.`);
console.log(`Next, the owner: escrow-owner.mjs rules '{"dao":"${DAO}",…}' (DEPLOY.md step 4).`);
