// Testnet check of the regulars release with real transactions: a fresh Sputnik DAO
// (3-account council, 2 of 3) hosts two events on the escrow through proposals built
// exactly like the site builds them (lib/daoShared.ts). Event A is closed by a DAO
// proposal; event B lets in only A's regulars until it opens to everyone: the regular
// registers, A's no-show and a newcomer get their USDC back, the newcomer gets in after
// the opening time; B is closed by the DAO too. Takes ~8 minutes (the events must end).
// Keys come from ~/.near-credentials/testnet (never printed). The relayer funds the DAO
// (5.6 NEAR: its code storage) and tops up test USDC.
// Env: EVENTS_CONTRACT, RELAYER_ACCOUNT, COUNCIL (3 accounts, comma-separated),
// GUESTS (regular,no-show,newcomer).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";
import { councilOf, functionCallProposal, isDaoAccount } from "../src/lib/daoShared.ts";
import { hostedStats } from "../src/lib/reputationShared.ts";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [EVENTS, RELAYER] = ["EVENTS_CONTRACT", "RELAYER_ACCOUNT"].map(env);
const COUNCIL = env("COUNCIL").split(",");
const [REGULAR, NO_SHOW, NEWCOMER] = env("GUESTS").split(",");
assert.equal(COUNCIL.length, 3);
const FACTORY = "sputnikv2.testnet";
const USDC = "usdc.tidepool-sandbox.testnet";
const TGAS = 1_000_000_000_000n;
const NEAR = 10n ** 24n;
const DEPOSIT = "100000"; // 0.1 USDC
const MIN = 60_000;
const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const secret = (id) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key;
const signer = (id) => new Account(id, provider, secret(id));
const relayer = signer(RELAYER);
const [voter1, voter2] = COUNCIL.map(signer);
const view = (method, args = {}, contractId = EVENTS) => provider.callFunction({ contractId, method, args });
const raw = (who, contractId, methodName, args, deposit = 0n, gas = 100n * TGAS) =>
  who.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
const failure = (outcome) => JSON.stringify(outcome.receipts_outcome.map((r) => r.outcome.status.Failure).filter(Boolean));
const value = (outcome) => JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString());
const burnt = (outcome) => outcome.receipts_outcome.reduce((n, r) => n + BigInt(r.outcome.gas_burnt), BigInt(outcome.transaction_outcome.outcome.gas_burnt));
const tgas = (gas) => `${(Number(gas) / 1e12).toFixed(1)} Tgas`;
const until = async (ms) => { while (Date.now() < ms) await new Promise((r) => setTimeout(r, 2000)); };
const step = (n, text) => console.log(`${n}. ${text}`);

// 0. Guests need test USDC and a USDC storage registration.
for (const guest of [REGULAR, NO_SHOW, NEWCOMER]) {
  if (!await view("storage_balance_of", { account_id: guest }, USDC)) {
    await raw(relayer, USDC, "storage_deposit", { account_id: guest, registration_only: true }, 125n * 10n ** 19n, 30n * TGAS);
  }
  if (BigInt(await view("ft_balance_of", { account_id: guest }, USDC)) < 500_000n) {
    await raw(relayer, USDC, "ft_transfer", { receiver_id: guest, amount: "1000000" }, 1n, 30n * TGAS);
  }
}

// 1. A fresh DAO (the free tier counts per host), the policy from docs/regulars/SPEC.md §3.2.
const name = `regulars${Date.now().toString(36)}`;
const DAO = `${name}.${FACTORY}`;
const policy = {
  roles: [{ name: "council", kind: { Group: COUNCIL }, permissions: ["*:AddProposal", "*:VoteApprove", "*:VoteReject", "*:VoteRemove", "*:Finalize"], vote_policy: {} }],
  default_vote_policy: { weight_kind: "RoleWeight", quorum: "0", threshold: [1, 2] },
  proposal_bond: "0", proposal_period: "259200000000000", bounty_bond: "0", bounty_forgiveness_period: "0",
};
const daoArgs = Buffer.from(JSON.stringify({ config: { name, purpose: "Nearvent regulars smoke test", metadata: "" }, policy })).toString("base64");
const created = await raw(relayer, FACTORY, "create", { name, args: daoArgs }, 56n * NEAR / 10n, 300n * TGAS); // ~545 KB of DAO code
assert.equal(failure(created), "[]", `DAO create failed: ${failure(created)}`);
assert.ok(isDaoAccount(DAO), "the site would not treat the DAO as a DAO");
assert.deepEqual(councilOf(await view("get_policy", {}, DAO)).sort(), [...COUNCIL].sort(), "the site would not find the council"); // a set on chain

// A proposal is approved by the second vote, which runs the call: returns that vote's outcome.
async function approve(id) {
  const { kind } = await view("get_proposal", { id }, DAO);
  await raw(voter1, DAO, "act_proposal", { id, action: "VoteApprove", proposal: kind }, 0n, 300n * TGAS);
  const outcome = await raw(voter2, DAO, "act_proposal", { id, action: "VoteApprove", proposal: kind }, 0n, 300n * TGAS);
  return { outcome, status: (await view("get_proposal", { id }, DAO)).status };
}
async function daoCall(description, method, args, deposit, gas) {
  const proposal = functionCallProposal({ description, receiverId: EVENTS, method, args, deposit, gas: String(gas) });
  const id = value(await raw(voter1, DAO, "add_proposal", proposal, BigInt(policy.proposal_bond), 100n * TGAS));
  const { outcome, status } = await approve(id);
  assert.equal(status, "Approved", `${method} proposal ${id} is ${status}: ${failure(outcome)}`);
  return outcome;
}
const update = value(await raw(voter1, DAO, "add_proposal", { proposal: { description: "No factory auto-update", kind: { FactoryInfoUpdate: { factory_info: { factory_id: FACTORY, auto_update: false } } } } }, 0n, 100n * TGAS));
assert.equal((await approve(update)).status, "Approved");
assert.equal((await view("get_factory_info", {}, DAO)).auto_update, false);
step(1, `DAO ${DAO}: council ${COUNCIL.join(", ")} (2 of 3), found by the site's isDaoAccount/councilOf; factory auto-update off`);

// The site's close button: the approving vote carries the call's gas (manage page).
const closeGas = (guests) => BigInt(Math.min(250, 50 + Math.ceil(guests * 0.7))) * TGAS;
const register = (who, eventId) => raw(signer(who), USDC, "ft_transfer_call", { receiver_id: EVENTS, amount: DEPOSIT, msg: JSON.stringify({ action: "register", event_id: eventId }) }, 1n, 100n * TGAS);
const daoEvent = async (title) => (await view("get_recent_events", { limit: 10 })).find((e) => e.host === DAO && e.metadata.title === title);

// 2. Event A: two guests, the regular comes, the other does not.
let now = Date.now();
const createA = await daoCall("Event A", "create_event", { metadata: { title: "Regulars A", starts_at: now, ends_at: now + 3 * MIN }, deposit: DEPOSIT, capacity: 10 }, "0", 50n * TGAS);
const A = await daoEvent("Regulars A");
assert.ok(A, "event A was not created");
for (const guest of [REGULAR, NO_SHOW]) await register(guest, A.id);
await until(A.metadata.ends_at + 5_000);
const beforeA = BigInt(await view("balance_of", { account_id: REGULAR }));
const closeA = await daoCall("Close A", "finalize", { event_id: A.id, attended: [REGULAR] }, "1", closeGas(2));
assert.equal((await view("get_event", { event_id: A.id })).status, "Finalized");
assert.equal(BigInt(await view("balance_of", { account_id: REGULAR })) - beforeA, 2n * BigInt(DEPOSIT), "the regular did not get the pool");
step(2, `event ${A.id} created (vote ${tgas(burnt(createA))}) and closed by the DAO (vote ${tgas(burnt(closeA))}, call gas ${tgas(closeGas(2))}); the regular got the pool`);

// 3. Event B: A's regulars only, then everyone.
now = Date.now();
const rule = { past_events: [A.id], min_attended: 1, max_no_shows: 0, open_to_all_at: now + 2 * MIN };
await daoCall("Event B", "create_event", { metadata: { title: "Regulars B", starts_at: now, ends_at: now + 4 * MIN }, deposit: DEPOSIT, capacity: 10, access: rule }, "0", 50n * TGAS);
const B = await daoEvent("Regulars B");
assert.ok(B, "event B was not created");
assert.deepEqual((await view("get_event", { event_id: B.id })).access, rule);
assert.deepEqual(await view("check_access", { event_id: B.id, account_id: REGULAR }), { allowed: true, attended: 1, no_shows: 0 });
assert.deepEqual(await view("check_access", { event_id: B.id, account_id: NO_SHOW }), { allowed: false, attended: 0, no_shows: 1 });
assert.deepEqual(await view("check_access", { event_id: B.id, account_id: NEWCOMER }), { allowed: false, attended: 0, no_shows: 0 });
assert.equal(value(await register(REGULAR, B.id)), DEPOSIT);
for (const guest of [NO_SHOW, NEWCOMER]) {
  const usdcBefore = await view("ft_balance_of", { account_id: guest }, USDC);
  assert.equal(value(await register(guest, B.id)), "0", `${guest} was let in`);
  assert.equal(await view("ft_balance_of", { account_id: guest }, USDC), usdcBefore, `${guest} lost USDC`);
  assert.equal(await view("get_guest_status", { event_id: B.id, account_id: guest }), null);
}
assert.ok(Date.now() < rule.open_to_all_at, "the checks ran past the opening time; rerun");
step(3, `event ${B.id} with rule ${JSON.stringify(rule)}: the regular registered, the no-show and the newcomer were refunded in full`);

await until(rule.open_to_all_at + 3_000);
assert.equal((await view("check_access", { event_id: B.id, account_id: NO_SHOW })).allowed, true);
assert.equal(value(await register(NEWCOMER, B.id)), DEPOSIT);
assert.equal(await view("get_guest_status", { event_id: B.id, account_id: NEWCOMER }), "Registered");
step(4, "after the opening time the newcomer registered");

// 5. B closes through the DAO; the DAO has held two events.
await until(B.metadata.ends_at + 5_000);
const closeB = await daoCall("Close B", "finalize", { event_id: B.id, attended: [REGULAR, NEWCOMER] }, "1", closeGas(2));
const paged = await view("get_events", { from_index: A.id, limit: 2 });
assert.deepEqual(paged.map((e) => [e.id, e.access ?? null]), [[A.id, null], [B.id, rule]]);
assert.deepEqual(hostedStats(paged, DAO), { hosted: 2, guestsCame: 3 });
step(5, `event ${B.id} closed by the DAO (vote ${tgas(burnt(closeB))}); the DAO held 2 events, 3 guests came; get_events pages`);
console.log("regulars testnet smoke passed");
