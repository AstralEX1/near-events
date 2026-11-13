import assert from "node:assert/strict";
import test from "node:test";
import { buildRule, rulePastEvents, ruleProblem, ruleText } from "../src/lib/access.ts";
import { councilOf, functionCallProposal, isDaoAccount } from "../src/lib/daoShared.ts";

const all = [
  { id: 0, host: "club.near", status: "Finalized" },
  { id: 1, host: "other.near", status: "Finalized" },
  { id: 2, host: "club.near", status: "Cancelled" },
  { id: 3, host: "club.near", status: "Open" },
  ...Array.from({ length: 11 }, (_, i) => ({ id: 4 + i, host: "club.near", status: "Finalized" })),
];

test("a rule looks at the host's own finalized events, newest first, at most 10", () => {
  assert.deepEqual(rulePastEvents(all, "club.near"), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.deepEqual(rulePastEvents(all, "other.near"), [1]);
  assert.deepEqual(rulePastEvents(all, "new.near"), []);
});

test("buildRule maps the three choices to the escrow's AccessRule", () => {
  const o = { pastEvents: [5, 4], minAttended: 1, skipNoShows: true, openToAllAt: 9_000 };
  assert.equal(buildRule("everyone", o), null);
  assert.deepEqual(buildRule("regulars-first", o), { past_events: [5, 4], min_attended: 1, max_no_shows: 0, open_to_all_at: 9_000 });
  assert.deepEqual(buildRule("regulars-only", { ...o, skipNoShows: false }), { past_events: [5, 4], min_attended: 1, max_no_shows: null, open_to_all_at: null });
});

test("ruleProblem mirrors the escrow's checks", () => {
  const rule = { past_events: [5, 4], min_attended: 1, max_no_shows: null, open_to_all_at: null };
  assert.equal(ruleProblem(null, 10), null);
  assert.equal(ruleProblem(rule, 10), null);
  assert.match(ruleProblem({ ...rule, past_events: [] }, 10), /finalized first/);
  assert.match(ruleProblem({ ...rule, min_attended: 3 }, 10), /1 to 2/);
  assert.match(ruleProblem({ ...rule, open_to_all_at: 10 }, 10), /before it ends/);
});

test("ruleText says who may register and until when", () => {
  const fmt = (ms) => `t${ms}`;
  const rule = { past_events: [5, 4, 3], min_attended: 1, max_no_shows: null, open_to_all_at: 100 };
  assert.equal(ruleText(rule, 0, fmt), "Regulars only: guests who came to 1 of the host's last 3 events, until t100. Then open to everyone.");
  assert.equal(ruleText(rule, 100, fmt), "Open to everyone.");
  assert.equal(ruleText({ ...rule, open_to_all_at: null, max_no_shows: 0 }, 0, fmt), "Regulars only: guests who came to 1 of the host's last 3 events and never skipped one.");
  assert.equal(ruleText({ ...rule, min_attended: 0, max_no_shows: 0, open_to_all_at: null }, 0, fmt), "Everyone except people who skipped any of the host's last 3 events.");
});

test("a DAO host's council acts as the host", () => {
  assert.ok(isDaoAccount("club.sputnik-dao.near") && isDaoAccount("club.sputnikv2.testnet"));
  assert.ok(!isDaoAccount("sputnik-dao.near") && !isDaoAccount("alice.near") && !isDaoAccount("club.sputnik-dao.testnet"));
  const policy = { roles: [{ name: "all", kind: "Everyone" }, { name: "council", kind: { Group: ["a.near", "b.near"] } }] };
  assert.deepEqual(councilOf(policy), ["a.near", "b.near"]);
  assert.deepEqual(councilOf({ roles: [] }), []);
});

test("functionCallProposal encodes the call the DAO will make", () => {
  const p = functionCallProposal({ description: "close", receiverId: "escrow.near", method: "finalize", args: { event_id: 3, attended: ["a.near"] }, deposit: "1", gas: "60000000000000" });
  const action = p.proposal.kind.FunctionCall.actions[0];
  assert.equal(p.proposal.kind.FunctionCall.receiver_id, "escrow.near");
  assert.deepEqual(JSON.parse(Buffer.from(action.args, "base64").toString()), { event_id: 3, attended: ["a.near"] });
  assert.deepEqual({ ...action, args: undefined }, { method_name: "finalize", args: undefined, deposit: "1", gas: "60000000000000" });
});
