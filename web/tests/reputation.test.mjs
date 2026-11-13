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
