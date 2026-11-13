import assert from "node:assert/strict";
import test from "node:test";
import { goingLine, guestStatus, mapQuery } from "../src/lib/eventLines.ts";

test("going line reads like Luma", () => {
  assert.equal(goingLine([], 0), "");
  assert.equal(goingLine(["Sam"], 1), "Sam");
  assert.equal(goingLine(["Sam", "Hasan"], 2), "Sam and Hasan");
  assert.equal(goingLine(["Sam", "Hasan"], 3), "Sam, Hasan and 1 other");
  assert.equal(goingLine(["Sam", "Hasan"], 14), "Sam, Hasan and 12 others");
  assert.equal(goingLine(["Sam"], 5), "Sam and 4 others");
});

test("map query uses the place name, then the pin, never a short link", () => {
  assert.equal(mapQuery("https://www.google.com/maps/place/Tribal+Bali/@-8.6,115.1,17z"), "Tribal Bali");
  assert.equal(mapQuery("https://www.google.com/maps/search/?api=1&query=Canggu%20Club"), "Canggu Club");
  assert.equal(mapQuery("https://www.google.com/maps/@-8.65,115.13,15z"), "-8.65,115.13");
  assert.equal(mapQuery("https://maps.app.goo.gl/abc123"), null);
  assert.equal(mapQuery("Jl. Pantai Berawa 1, Canggu"), "Jl. Pantai Berawa 1, Canggu");
});

test("guest status follows the phase: door marks, then the host's list, then payouts", () => {
  const ev = (status, extra = {}) => ({ status, mode: "Deposit", abandoned: false, attended_count: 1, ...extra });
  const off = { status: "Registered", listed: false };
  const on = { status: "Registered", listed: true };
  assert.deepEqual(guestStatus(ev("Open"), off), { label: "Going", tone: "good" });
  assert.equal(guestStatus(ev("Open"), { status: "Attended", listed: false }).label, "Checked in");
  // After the list is published a guest left off it is no longer "going".
  assert.equal(guestStatus(ev("Submitted"), off).label, "Not on your list");
  assert.equal(guestStatus(ev("Submitted"), on, false).label, "On the list");
  assert.equal(guestStatus(ev("Submitted", { abandoned: true }), off).label, "No list");
  assert.equal(guestStatus(ev("Finalized"), off).label, "No-show");
  assert.equal(guestStatus(ev("Finalized", { attended_count: 0 }), off).label, "Refunded");
  assert.equal(guestStatus(ev("Cancelled", { mode: "Ticket" }), off).label, "Ticket");
});
