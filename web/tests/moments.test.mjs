import assert from "node:assert/strict";
import test from "node:test";
import { mayRemove, momentProblem } from "../src/lib/momentsShared.ts";

test("only guests and hosts add photos, and only after the event ends", () => {
  assert.equal(momentProblem({ ended: true, host: false, guest: true }), null);
  assert.equal(momentProblem({ ended: true, host: true, guest: false }), null);
  assert.notEqual(momentProblem({ ended: true, host: false, guest: false }), null);
  assert.notEqual(momentProblem({ ended: false, host: true, guest: true }), null);
});

test("a photo is removed by the person who added it or by the host", () => {
  assert.equal(mayRemove({ by: "a.near" }, "a.near", false), true);
  assert.equal(mayRemove({ by: "a.near" }, "b.near", true), true);
  assert.equal(mayRemove({ by: "a.near" }, "b.near", false), false);
});
