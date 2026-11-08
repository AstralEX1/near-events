import assert from "node:assert/strict";
import test from "node:test";
import { MAX_COHOSTS, cohostsProblem, normalizeCohosts, splitCohosts } from "../src/lib/cohostsShared.ts";

test("door team text splits on commas and spaces", () => {
  assert.deepEqual(splitCohosts(" Alice.near, bob.near  carol.testnet,,"), ["alice.near", "bob.near", "carol.testnet"]);
  assert.equal(cohostsProblem(""), null);
  assert.equal(cohostsProblem("alice.near, 0x1234"), null);
});

test("door team rejects bad accounts and too many people", () => {
  assert.match(cohostsProblem("alice.near, not an@account"), /not a NEAR account/);
  const many = Array.from({ length: MAX_COHOSTS + 1 }, (_, i) => `door${i}.near`).join(",");
  assert.match(cohostsProblem(many), /Up to 10/);
});

test("server-side normalisation drops the host and duplicates", () => {
  assert.deepEqual(normalizeCohosts(["Bob.near", "bob.near", "host.near"], "host.near"), ["bob.near"]);
  assert.equal(normalizeCohosts("bob.near"), null);
  assert.equal(normalizeCohosts(["bad account"]), null);
  assert.equal(normalizeCohosts(Array.from({ length: 11 }, (_, i) => `d${i}.near`)), null);
});
