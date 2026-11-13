import assert from "node:assert/strict";
import test from "node:test";
import { CLOCK_MARGIN_MS as M, planEvent, verdictProposal } from "../src/lib/keeperPlan.ts";

const ESCROW = "escrow-v3.testnet";
const SITE = "https://www.nearvent.site";
const BOT = "bot.testnet";
const base = { id: 7, mode: "Deposit", dao: "court.sputnikv2.testnet", challenge_ends_at: 1_000_000, resolve_by: 5_000_000, submit_by: 500_000 };
const dispute = (target, upheld = null) => ({ target, challenger: target, attended: true, upheld });
const plan = (e, now, disputes = [], existing = []) => planEvent({ ...base, ...e }, now, disputes, existing, ESCROW, SITE, BOT);
/** What the DAO returns for a proposal the bot made for `action`. */
const onChain = (action, over = {}) => ({ proposer: BOT, description: action.description, kind: verdictProposal(action, ESCROW).proposal.kind, status: "InProgress", ...over });

test("settles a minute after the window, once nothing waits for the DAO", () => {
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 0 }, 1_000_000), []);
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 0 }, 1_000_000 + M), [{ kind: "settle", eventId: 7 }]);
  // An open dispute holds settlement until it expires at resolve_by.
  const [up, down] = plan({ status: "Submitted", open_disputes: 1 }, 100, [dispute("a.near")]);
  assert.equal(plan({ status: "Submitted", open_disputes: 1 }, 4_000_000, [dispute("a.near")], [onChain(up), onChain(down)]).length, 0);
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 1 }, 5_000_000 + M, [dispute("a.near")]), [{ kind: "settle", eventId: 7 }]);
});

test("refunds an Open deposit event only after the publish deadline", () => {
  assert.deepEqual(plan({ status: "Open" }, 500_000 + M), []);
  assert.deepEqual(plan({ status: "Open" }, 500_001 + M), [{ kind: "refund", eventId: 7 }]);
  assert.deepEqual(plan({ status: "Open", mode: "Ticket" }, 10_000_000), []);
  for (const status of ["Finalized", "Cancelled", "Refunded"]) assert.deepEqual(plan({ status }, 10_000_000), []);
});

test("opens one Uphold / Dismiss pair per undecided dispute, and only once", () => {
  const disputes = [dispute("a.near"), dispute("b.near", true)];
  const first = plan({ status: "Submitted", open_disputes: 1 }, 100, disputes);
  assert.deepEqual(first.map((a) => [a.kind, a.target, a.upheld]), [["propose", "a.near", true], ["propose", "a.near", false]]);
  assert.ok(first[0].description.includes(`${SITE}/e/7`));
  // Idempotent: the next tick finds both of the bot's proposals and sends nothing.
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 1 }, 200, disputes, first.map((a) => onChain(a))), []);
  // One of the pair missing: only that one is sent.
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 1 }, 200, disputes, [onChain(first[0])]).map((a) => a.upheld), [false]);
  // Past resolve_by (minus a margin) no new proposals: the escrow would refuse the verdict.
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 1, challenge_ends_at: 10_000_000 }, 5_000_000 - M, disputes), []);
});

test("a copied description does not hide a missing proposal (audit M1)", () => {
  const [up] = plan({ status: "Submitted", open_disputes: 1 }, 100, [dispute("a.near")]);
  // Same text from a council member, or with the bot's text but another guest inside.
  const forged = [
    onChain(up, { proposer: "council.near" }),
    { ...onChain(up), kind: verdictProposal({ ...up, target: "x.near" }, ESCROW).proposal.kind },
  ];
  assert.deepEqual(plan({ status: "Submitted", open_disputes: 1 }, 200, [dispute("a.near")], forged).map((a) => a.upheld), [true, false]);
  // An expired pair is proposed again; a rejected one is not.
  assert.equal(plan({ status: "Submitted", open_disputes: 1 }, 200, [dispute("a.near")], [onChain(up, { status: "Expired" })]).filter((a) => a.upheld).length, 1);
  assert.equal(plan({ status: "Submitted", open_disputes: 1 }, 200, [dispute("a.near")], [onChain(up, { status: "Rejected" })]).filter((a) => a.upheld).length, 0);
});

test("a verdict proposal calls resolve_dispute on the escrow with no deposit", () => {
  const [a] = plan({ status: "Submitted", open_disputes: 1 }, 100, [dispute("a.near")]);
  const p = verdictProposal(a, ESCROW).proposal.kind.FunctionCall;
  assert.equal(p.receiver_id, ESCROW);
  const [action] = p.actions;
  assert.equal(action.method_name, "resolve_dispute");
  assert.equal(action.deposit, "0");
  assert.deepEqual(JSON.parse(Buffer.from(action.args, "base64").toString()), { event_id: 7, target: "a.near", upheld: true });
});

test("the bot proposes at most 10 disputes per event, 'I came' first", async () => {
  const { MAX_DISPUTES_PROPOSED } = await import("../src/lib/keeperPlan.ts");
  const absent = Array.from({ length: 12 }, (_, i) => ({ target: `g${i}.testnet`, challenger: "x.testnet", attended: false, upheld: null }));
  const came = { target: "late.testnet", challenger: "late.testnet", attended: true, upheld: null };
  const actions = plan({ status: "Submitted", open_disputes: 13 }, 1_000_000 - M, [...absent, came]);
  assert.equal(actions.length, 2 * MAX_DISPUTES_PROPOSED);
  assert.equal(actions[0].target, "late.testnet");
});
