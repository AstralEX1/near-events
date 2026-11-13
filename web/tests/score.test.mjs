import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { score, TRUST_THRESHOLD } from "../src/lib/score.ts";
import { reputationIndex } from "../src/lib/reputationShared.ts";

// Vectors from docs/oracle-upgrade/evidence/score-vectors.py (the Python reference).
const vectors = JSON.parse(readFileSync(new URL("./fixtures/score-v3-vectors.json", import.meta.url), "utf8"));

test("score matches the Python reference on every profile and random input", () => {
  assert.equal(TRUST_THRESHOLD, vectors.threshold);
  for (const v of vectors.cases) {
    const got = score(v.input);
    assert.equal(got.score, v.score, v.name);
    assert.deepEqual(got.parts, v.parts, v.name);
  }
});

test("the best free farmer stays below the trust threshold", () => {
  let best = 0;
  for (const fakeHosts of [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]) {
    for (const perHost of [1, 3, 10, 50]) {
      for (const hostedEvents of [0, 1, 4, 50]) {
        const attended = Array.from({ length: fakeHosts * perHost }, (_, i) => ({ host: `f${Math.floor(i / perHost)}`, trusted: false }));
        const hosted = Array.from({ length: hostedEvents }, () => ({ attendees: 50, withHistory: 0, upheld: 0 }));
        best = Math.max(best, score({ attended, noShows: 0, hosted, disputesWon: 0, disputesLost: 0 }).score);
      }
    }
  }
  assert.equal(best, vectors.best_free_farmer);
  assert.ok(best <= TRUST_THRESHOLD - 5);
});

test("reputationIndex builds the counters from on-chain records", () => {
  const ev = (id, host, extra = {}) => ({ id, host, status: "Finalized", mode: "Deposit", created_at: id * 1000, attended_count: 0, upheld_disputes: 0, ...extra });
  const facts = {
    events: [
      ev(1, "trusted.near", { attended_count: 3 }),
      ev(2, "host.near", { attended_count: 3, upheld_disputes: 1 }),
      ev(3, "host.near", { attended_count: 0 }),
      ev(4, "host.near", { status: "Refunded" }),
      ev(5, "shop.near", { mode: "Ticket", attended_count: 1 }),
    ],
    guests: {
      1: [{ account_id: "a.near", status: "Attended" }, { account_id: "b.near", status: "Attended" }, { account_id: "c.near", status: "Attended" }, { account_id: "d.near", status: "Registered" }],
      2: [{ account_id: "a.near", status: "Attended" }, { account_id: "b.near", status: "Attended" }, { account_id: "c.near", status: "Attended" }, { account_id: "d.near", status: "Registered" }],
      3: [{ account_id: "d.near", status: "Registered" }],
      5: [{ account_id: "a.near", status: "Attended" }],
    },
    disputes: {
      2: [
        { challenger: "c.near", created_at: 2500, via_intents: false, upheld: true },
        { challenger: "d.near", created_at: 2600, via_intents: false, upheld: false },
        { challenger: "b.near", created_at: 2700, via_intents: true, upheld: false },
      ],
    },
  };
  const index = reputationIndex(facts, [{ account: "trusted.near", from: 0 }]);
  const a = index.get("a.near");
  // Ticket attendance counts for the badge, not for the score.
  assert.equal(a.attended, 3);
  assert.equal(a.noShows, 0);
  const d = index.get("d.near");
  // Event 3 had nobody checked in: everyone was refunded, so it is not a no-show.
  assert.equal(d.noShows, 2);
  assert.equal(d.disputesLost, 1);
  assert.equal(index.get("b.near").disputesLost, 0, "an Intents-paid loss is not held against the name");
  assert.equal(index.get("c.near").disputesWon, 1);
  const host = index.get("host.near");
  assert.equal(host.hosted, 2);
  assert.equal(host.abandoned, 1);
  // One corrected record in the last 10 hosted events: a 15-point penalty.
  assert.equal(host.parts.penalty, -15);
  const trusted = index.get("trusted.near");
  assert.equal(trusted.hosted, 1);
  // a, b and c came to a trusted host's event before event 2: it has 3 attendees with history.
  assert.ok(index.get("a.near").score > index.get("d.near").score);
});
