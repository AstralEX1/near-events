import assert from "node:assert/strict";
import test from "node:test";
import { freeEventProblem, isFreeEventId } from "../src/lib/freeEventsShared.ts";
import { createStep, formUrl } from "../src/lib/flow.ts";

const ok = {
  title: "Beach cleanup", starts_at: 1_800_000_000_000, ends_at: 1_800_000_360_000, capacity: 40,
  location: "", description: "", cover_url: null, visual: { themeId: "paradise", seed: 7 }, public: true,
};

test("freeEventProblem accepts a valid free event and rejects bad input", () => {
  assert.equal(freeEventProblem(ok), null);
  assert.equal(freeEventProblem({ ...ok, cover_url: "https://example.com/a.jpg", location: "https://maps.app.goo.gl/abc" }), null);
  assert.equal(freeEventProblem({ ...ok, approval: true }), null);
  for (const bad of [
    null, {}, { ...ok, title: " " }, { ...ok, title: "x".repeat(121) }, { ...ok, ends_at: ok.starts_at },
    { ...ok, capacity: 0 }, { ...ok, capacity: 1001 }, { ...ok, capacity: 1.5 }, { ...ok, location: "Bali" },
    { ...ok, cover_url: "javascript:alert(1)" }, { ...ok, visual: { themeId: "nope", seed: 1 } }, { ...ok, public: "yes" },
    { ...ok, approval: "yes" },
  ]) assert.notEqual(freeEventProblem(bad), null, JSON.stringify(bad));
});

test("free event ids never look like on-chain ids", () => {
  assert.equal(isFreeEventId("aB3_-xYz"), true);
  assert.equal(isFreeEventId("4"), false);
  assert.equal(isFreeEventId("../etc"), false);
});

test("Free skips the amount on Create and is never used by Integrate", () => {
  const params = (url) => new URL(url, "https://x").searchParams;
  assert.equal(formUrl({ mode: "Free", amount: "" }), "/create?mode=Free");
  assert.equal(createStep(params("/create?mode=Free")), "form");
  assert.equal(createStep(params("/create?flow=widget&mode=Free&import=https://lu.ma/abc")), "start-widget");
});
