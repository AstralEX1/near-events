import assert from "node:assert/strict";
import test from "node:test";
import { detectEventSource, isGoogleMapsLink, locationProblem, lumaLocation, schemaOrgLocation } from "../src/lib/eventImport.ts";
import { aiPrompt, buttonCode, checkoutLink, eventPageLink } from "../src/lib/integration.ts";

test("detectEventSource recognises Luma and BaliSquad links only", () => {
  for (const link of ["https://lu.ma/abc123", "lu.ma/abc123", "https://luma.com/abc123", "https://www.luma.com/event/abc123"]) {
    assert.equal(detectEventSource(link), "Luma", link);
  }
  for (const link of ["https://balisquad.com/event/a-party", "https://www.balisquad.com/id/event/a-party", "balisquad.com/event/a-party"]) {
    assert.equal(detectEventSource(link), "BaliSquad", link);
  }
  for (const link of ["", "   ", "abc", "https://example.com/event/a", "https://lu.ma.evil.example/abc", "https://notlu.ma/abc", "https://lu.ma/", "ftp://lu.ma/abc", "javascript:alert(1)"]) {
    assert.equal(detectEventSource(link), null, link);
  }
});

test("isGoogleMapsLink accepts Google Maps links only", () => {
  for (const link of [
    "https://www.google.com/maps/place/Cafe",
    "https://google.com/maps?q=1,2",
    "https://www.google.com/maps/search/?api=1&query=1,2",
    "https://maps.google.com/?cid=123",
    "https://maps.app.goo.gl/abc",
    "https://goo.gl/maps/abc",
  ]) assert.equal(isGoogleMapsLink(link), true, link);
  for (const link of [
    "",
    "Jl. Pantai 1, Bali",
    "http://maps.google.com/?cid=123",
    "https://www.google.com/search?q=cafe",
    "https://www.google.com/mapsfake",
    "https://goo.gl/abc",
    "https://maps.google.com.evil.example/",
    "https://www.google.com@evil.example/maps",
    "https://user:pw@www.google.com/maps",
    "javascript:alert(1)",
  ]) assert.equal(isGoogleMapsLink(link), false, link);
});

test("locationProblem allows empty or a Maps link and gives a short error otherwise", () => {
  assert.equal(locationProblem(""), null);
  assert.equal(locationProblem("   "), null);
  assert.equal(locationProblem(" https://maps.app.goo.gl/abc "), null);
  assert.equal(locationProblem("Warung Yess, Bali"), "Location must be a Google Maps link.");
  assert.equal(locationProblem(`https://maps.google.com/?q=${"x".repeat(1000)}`), "Map link is too long.");
});

test("lumaLocation builds a Maps link and never returns the address", () => {
  const place = { full_address: "Warung Yess, Bali", address: "Warung Yess", place_id: "ChIJ1" };
  const coordinate = { latitude: -8.64, longitude: 115.12 };
  assert.equal(
    lumaLocation({ geo_address_visibility: "public", geo_address_info: place, coordinate }),
    "https://www.google.com/maps/search/?api=1&query=-8.64%2C115.12&query_place_id=ChIJ1",
  );
  assert.equal(
    lumaLocation({ geo_address_visibility: "public", geo_address_info: { full_address: "Warung Yess, Bali" } }),
    "https://www.google.com/maps/search/?api=1&query=Warung%20Yess%2C%20Bali",
  );
  assert.equal(lumaLocation({ geo_address_visibility: "guests-only", geo_address_info: place, coordinate }), "");
  assert.equal(lumaLocation({ geo_address_info: { place_id: "ChIJ1" } }), "https://www.google.com/maps/search/?api=1&query=place_id%3AChIJ1&query_place_id=ChIJ1");
  assert.equal(lumaLocation({ geo_address_visibility: "public" }), "");
  assert.equal(lumaLocation({ geo_address_visibility: "public", geo_address_info: {} }), "");
});

test("schemaOrgLocation prefers the given Maps link, then coordinates, then text", () => {
  const address = { streetAddress: "Jl. Pantai 1", addressLocality: "Canggu" };
  const geo = { latitude: -8.78, longitude: 115.17 };
  assert.equal(schemaOrgLocation({ name: "Cafe", address, geo, sameAs: "https://maps.google.com/?cid=19" }), "https://maps.google.com/?cid=19");
  assert.equal(schemaOrgLocation({ sameAs: "http://maps.google.com/?cid=19" }), "https://maps.google.com/?cid=19");
  assert.equal(schemaOrgLocation({ name: "Cafe", geo, sameAs: "https://cafe.example" }), "https://www.google.com/maps/search/?api=1&query=-8.78%2C115.17");
  assert.equal(schemaOrgLocation({ name: "Cafe", address }), "https://www.google.com/maps/search/?api=1&query=Cafe%2C%20Jl.%20Pantai%201%2C%20Canggu");
  assert.equal(schemaOrgLocation("Cafe"), "https://www.google.com/maps/search/?api=1&query=Cafe");
  assert.equal(schemaOrgLocation({}), "");
  assert.equal(schemaOrgLocation(undefined), "");
});

const target = { origin: "https://near.me", eventId: 7 };

test("buttonCode and links use the real origin and event id", () => {
  assert.equal(buttonCode(target), '<script src="https://near.me/embed.js" async></script>\n<near-event event="7" mode="button"></near-event>');
  assert.equal(checkoutLink(target), "https://near.me/p/7");
  assert.equal(eventPageLink(target), "https://near.me/e/7");
});

test("then is escaped in the button and encoded in the link", () => {
  const then = 'https://a.example/?x=1&y="2"';
  assert.match(buttonCode({ ...target, then }), /then="https:\/\/a\.example\/\?x=1&amp;y=&quot;2&quot;"/);
  assert.equal(checkoutLink({ ...target, then }), `https://near.me/p/7?then=${encodeURIComponent(then)}`);
});

test("aiPrompt has the real values, no placeholders, and describes the event's mode", () => {
  for (const mode of ["Deposit", "Ticket"]) {
    const prompt = aiPrompt(target, mode);
    assert.ok(prompt.includes(buttonCode(target).split("\n")[0]));
    assert.ok(prompt.includes(buttonCode(target).split("\n")[1]));
    assert.ok(prompt.includes("https://near.me/p/7"));
    assert.ok(prompt.includes("NearEvents.open(7)"));
    assert.doesNotMatch(prompt, /YOUR-NEAR-ME-HOST|EVENT_ID/);
  }
  assert.match(aiPrompt(target, "Deposit"), /refundable USDC deposit/);
  assert.match(aiPrompt(target, "Ticket"), /buying a USDC ticket/);
  assert.doesNotMatch(aiPrompt(target, "Ticket"), /deposit/i);
});
