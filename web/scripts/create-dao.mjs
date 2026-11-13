// Creates the host DAO (Sputnik, policy from docs/regulars/SPEC.md §3.2: a council of 3,
// 2 votes pass, no bond) and, when the creator is on the council, proposes turning off
// the factory's code auto-update; two council votes approve it (sputnik-dao.trezu.org).
// The creator's key comes from ~/.near-credentials/<NETWORK>/<CREATOR>.json or a hidden
// prompt (private key or seed phrase; never printed or saved). Mainnet asks for a typed "yes".
// Env: CREATOR, NAME, COUNCIL (3 accounts, comma-separated), optional NETWORK (testnet | mainnet),
// DEPOSIT in NEAR (default 0.5 on mainnet, where the DAO code is a global contract; 5.6 on testnet).
import assert from "node:assert/strict";
import { Account, JsonRpcProvider, parseNearAmount } from "near-api-js";
import { accountKey, ask, closePrompts, fail } from "./keyPrompt.mjs";

const network = process.env.NETWORK ?? "testnet";
const mainnet = network === "mainnet";
const FACTORY = mainnet ? "sputnik-dao.near" : "sputnikv2.testnet";
const [CREATOR, NAME] = [process.env.CREATOR, process.env.NAME];
const COUNCIL = (process.env.COUNCIL ?? "").split(",").filter(Boolean);
if (!CREATOR || !/^[a-z0-9-]{2,40}$/.test(NAME ?? "") || COUNCIL.length !== 3) fail("Set CREATOR, NAME (a-z, 0-9, -) and COUNCIL (3 accounts)");
const DAO = `${NAME}.${FACTORY}`;
const deposit = BigInt(parseNearAmount(process.env.DEPOSIT ?? (mainnet ? "0.5" : "5.6")) ?? fail("Bad DEPOSIT"));
const provider = new JsonRpcProvider({ url: mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com" });
const TGAS = 1_000_000_000_000n;

for (const id of COUNCIL) await provider.viewAccount({ accountId: id }).catch(() => fail(`${id} does not exist on ${network}`));
if (await provider.viewAccount({ accountId: DAO }).catch(() => null)) fail(`${DAO} already exists`);
const policy = {
  roles: [{ name: "council", kind: { Group: COUNCIL }, permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "0", proposal_period: "259200000000000", bounty_bond: "0", bounty_forgiveness_period: "0",
};
const creator = new Account(CREATOR, provider, (await accountKey(provider, network, CREATOR)).toString());
console.log(`${network}: create ${DAO} from ${CREATOR} with ${(Number(deposit) / 1e24).toFixed(2)} NEAR, council ${COUNCIL.join(", ")} (2 of 3)`);
if (mainnet && (await ask('Type "yes" to send: ')) !== "yes") fail("Cancelled; nothing was sent.");
closePrompts();

const args = Buffer.from(JSON.stringify({ config: { name: NAME, purpose: "Nearvent events", metadata: "" }, policy })).toString("base64");
const created = await creator.callFunctionRaw({ contractId: FACTORY, methodName: "create", args: { name: NAME, args }, deposit, gas: 300n * TGAS, waitUntil: "FINAL" });
const failed = created.receipts_outcome.map((r) => r.outcome.status.Failure).filter(Boolean);
if (failed.length) fail(`Create failed (the deposit comes back): ${JSON.stringify(failed)}`);
assert.deepEqual((await provider.callFunction({ contractId: DAO, method: "get_policy", args: {} })).roles[0].kind.Group.sort(), [...COUNCIL].sort());
console.log("created", DAO, "tx", created.transaction.hash);

if (!COUNCIL.includes(CREATOR)) {
  console.log(`A council member proposes FactoryInfoUpdate {factory_id: "${FACTORY}", auto_update: false}.`);
  process.exit(0);
}
const proposed = await creator.callFunctionRaw({
  contractId: DAO, methodName: "add_proposal", deposit: 0n, gas: 100n * TGAS, waitUntil: "FINAL",
  args: { proposal: { description: "Turn off the factory's code auto-update", kind: { FactoryInfoUpdate: { factory_info: { factory_id: FACTORY, auto_update: false } } } } },
});
const id = JSON.parse(Buffer.from(proposed.status.SuccessValue, "base64").toString());
console.log(`proposal ${id}: auto_update off; 2 council votes approve it. Then get_factory_info shows auto_update: false.`);
