import assert from "node:assert/strict";
import test from "node:test";
import { cleanHandle, cleanProfile, cleanWebsite, displayName, linkPlan, linkUrl } from "../src/lib/profilesShared.ts";

const avatar = `/api/covers/${"a".repeat(64)}`;

test("cleanProfile normalizes a good profile", () => {
  const r = cleanProfile({
    username: " @Alex_1 ", first_name: " Alex  ", last_name: "", avatar_url: `https://www.nearvent.site${avatar}`,
    links: { x: "https://x.com/alex?s=1", telegram: "@alex_tg", instagram: "instagram.com/alex.ig/", website: "nearvent.site" },
  });
  assert.deepEqual(r, { profile: {
    username: "alex_1", first_name: "Alex", last_name: "", avatar_url: avatar, avatar_seed: null,
    links: { x: "alex", telegram: "alex_tg", instagram: "alex.ig", website: "https://nearvent.site/" },
  } });
  assert.equal(displayName(r.profile), "Alex");
  assert.equal(displayName({ ...r.profile, first_name: "" }), "@alex_1");
  assert.equal(linkUrl("telegram", "alex_tg"), "https://t.me/alex_tg");
});

test("cleanProfile rejects bad input", () => {
  for (const bad of [
    null, { username: "ab" }, { username: "has space" }, { username: "x".repeat(21) }, { first_name: "x".repeat(61) },
    { avatar_url: "https://evil.example/pixel.jpg" }, { avatar_url: "/api/covers/../../x" },
    { links: { x: "https://evil.com/alex" } }, { avatar_seed: -1 }, { avatar_seed: 1.5 }, { avatar_seed: 2 ** 32 }, { links: { telegram: "ab" } }, { links: { website: "javascript:alert(1)" } },
  ]) assert.ok("error" in cleanProfile(bad), JSON.stringify(bad));
});

test("handles and websites", () => {
  assert.equal(cleanHandle("x", "twitter.com/jack"), "jack");
  assert.equal(cleanHandle("x", "@jack"), "jack");
  assert.equal(cleanHandle("instagram", "https://t.me/jack"), null);
  assert.equal(cleanWebsite("ftp://a.com"), null);
  assert.equal(cleanWebsite("localhost"), null);
});

test("a random avatar seed is kept", () => {
  assert.equal(cleanProfile({ avatar_seed: 4_000_000_000 }).profile.avatar_seed, 4_000_000_000);
});

test("linkPlan keeps the profile that has linked wallets or a profile", () => {
  const one = (w, hasProfile = false) => ({ wallets: [w], hasProfile });
  assert.deepEqual(linkPlan(one("a.near"), one("0xb")), { primary: "a.near", join: "0xb" });
  assert.deepEqual(linkPlan(one("a.near"), one("0xb", true)), { primary: "0xb", join: "a.near" });
  assert.deepEqual(linkPlan(one("a.near", true), one("0xb", true)), { primary: "a.near", join: "0xb" });
  assert.deepEqual(linkPlan(one("c.near", true), { wallets: ["0xb", "a.near"], hasProfile: true }), { primary: "0xb", join: "c.near" });
  assert.ok("error" in linkPlan({ wallets: ["0xb", "a.near"], hasProfile: true }, { wallets: ["0xb", "a.near"], hasProfile: true }));
  assert.ok("error" in linkPlan({ wallets: ["x", "y"], hasProfile: true }, { wallets: ["z", "w"], hasProfile: true }));
  assert.ok("error" in linkPlan({ wallets: Array.from({ length: 10 }, (_, i) => `w${i}`), hasProfile: true }, one("new")));
});
