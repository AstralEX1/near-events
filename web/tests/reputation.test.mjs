import assert from "node:assert/strict";
import test from "node:test";
import { hostedStats } from "../src/lib/reputationShared.ts";

test("hostedStats counts the host's non-cancelled events and guests at closed ones", () => {
  const all = [
    { host: "steve.testnet", status: "Finalized", attended_count: 12 },
    { host: "steve.testnet", status: "Open", attended_count: 3 },
    { host: "steve.testnet", status: "Cancelled", attended_count: 0 },
    { host: "atia.testnet", status: "Finalized", attended_count: 5 },
  ];
  assert.deepEqual(hostedStats(all, "steve.testnet"), { hosted: 2, guestsCame: 12 });
  assert.deepEqual(hostedStats(all, "nobody.testnet"), { hosted: 0, guestsCame: 0 });
});
