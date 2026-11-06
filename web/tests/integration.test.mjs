import assert from "node:assert/strict";
import test from "node:test";
import { detectEventSource, fitImportedEvent } from "../src/lib/eventImport.ts";
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

test("fitImportedEvent keeps imports within the escrow limits", () => {
  const base = { title: "T", starts_at: 1, ends_at: 2 };
  const small = { ...base, location: "Cafe\nMap: https://m.example/1", description: "Hello" };
  assert.deepEqual(fitImportedEvent(small), { event: small, shortened: false });

  const longMap = { ...base, location: `Cafe, Bali\nMap: https://m.example/${"x".repeat(320)}`, description: "é".repeat(1500) };
  const { event, shortened } = fitImportedEvent(longMap);
  assert.equal(shortened, true);
  assert.equal(event.location, "Cafe, Bali");
  assert.ok(new TextEncoder().encode(event.description).length <= 2000);
  assert.ok(event.description.endsWith("…"));
  assert.ok(new TextEncoder().encode(fitImportedEvent({ ...base, location: "a".repeat(400), description: "" }).event.location).length <= 300);
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
