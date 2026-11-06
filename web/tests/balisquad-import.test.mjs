import assert from "node:assert/strict";
import test from "node:test";
import { parseBaliSquadEvent } from "../src/lib/balisquadImport.ts";

function eventHtml(overrides = {}, details = "") {
  const event = {
    "@context": "https://schema.org",
    "@type": "Event",
    url: "https://balisquad.com/event/example-event",
    name: "Example event",
    startDate: "2026-11-06T18:00:59",
    endDate: "2026-11-06T20:00:00",
    location: {
      "@type": "Place",
      name: "Example venue",
      sameAs: "https://www.google.com/maps/place/example",
    },
    description: "Structured fallback",
    ...overrides,
  };
  return `<script type="application/ld+json">${JSON.stringify(event)}</script><div class="event-description">${details}</div>`;
}

test("BaliSquad import keeps wall-clock seconds, nested details, links, and Google Maps", () => {
  const event = parseBaliSquadEvent(
    eventHtml({}, "<div>Intro</div><a href=\"https://example.com/rsvp\">RSVP</a>"),
    "example-event",
  );

  assert.ok(event);
  assert.equal(event.starts_at, Date.parse("2026-11-06T18:00:59+08:00"));
  assert.match(event.description, /Intro/);
  assert.match(event.description, /RSVP: https:\/\/example\.com\/rsvp/);
  assert.match(event.location, /https:\/\/www\.google\.com\/maps\/place\/example/);
});

test("BaliSquad import rejects normalized or impossible wall-clock dates", () => {
  for (const startDate of [
    "2026-13-01T18:00",
    "2026-11-06T25:00",
    "2026-02-29T18:00",
  ]) {
    assert.equal(parseBaliSquadEvent(eventHtml({ startDate })), null, startDate);
  }
});
