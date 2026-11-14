import assert from "node:assert/strict";
import test from "node:test";
import { hostedStats } from "../src/lib/reputationShared.ts";

test("hostedStats counts the events the host held (finalized) and guests who came to them", () => {
  const all = [
    { host: "steve.testnet", status: "Finalized", attended_count: 12 },
    { host: "steve.testnet", status: "Open", attended_count: 3 },
    { host: "steve.testnet", status: "Cancelled", attended_count: 0 },
    { host: "atia.testnet", status: "Finalized", attended_count: 5 },
  ];
  assert.deepEqual(hostedStats(all, "steve.testnet"), { hosted: 1, guestsCame: 12 });
  assert.deepEqual(hostedStats(all, "nobody.testnet"), { hosted: 0, guestsCame: 0 });
});

test("names on one page share one /api/reputation request; imported guests are skipped; a failed load is retried", async () => {
  const { loadReputation } = await import("../src/lib/reputation.ts");
  const asked = [];
  let fail = false;
  globalThis.fetch = async (url) => {
    const accounts = new URL(url, "http://x").searchParams.get("a").split(",");
    asked.push(accounts);
    if (fail) return new Response("{}", { status: 502 });
    return Response.json({ accounts: Object.fromEntries(accounts.map((a) => [a, { attended: a.length, hosted: 0, guestsCame: 0 }])) });
  };
  const [leo, mia, imported] = await Promise.all([loadReputation("leo.near"), loadReputation("mia.near"), loadReputation("balisquad:ann")]);
  assert.deepEqual(asked, [["leo.near", "mia.near"]]);
  assert.equal(leo.attended, 8);
  assert.equal(mia.attended, 8);
  assert.equal(imported, null);
  await loadReputation("leo.near");
  assert.equal(asked.length, 1, "kept for a minute");
  fail = true;
  assert.equal(await loadReputation("bob.near"), null);
  fail = false;
  assert.equal((await loadReputation("bob.near")).attended, 8);
  assert.equal(asked.length, 3, "a failed load is asked again");
});
