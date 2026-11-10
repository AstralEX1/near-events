import assert from "node:assert/strict";
import test from "node:test";
import { cleanHandle, cleanProfile, cleanWebsite, displayName, linkUrl } from "../src/lib/profilesShared.ts";

const avatar = `/api/covers/${"a".repeat(64)}`;

test("cleanProfile normalizes a good profile", () => {
  const r = cleanProfile({
    nickname: " @Alex_1 ", first_name: " Alex  ", last_name: "", avatar_url: `https://www.nearvent.site${avatar}`,
    links: { x: "https://x.com/alex?s=1", telegram: "@alex_tg", instagram: "instagram.com/alex.ig/", website: "nearvent.site" },
  });
  assert.deepEqual(r, { profile: {
    nickname: "alex_1", first_name: "Alex", last_name: "", avatar_url: avatar, avatar_seed: null,
    links: { x: "alex", telegram: "alex_tg", instagram: "alex.ig", website: "https://nearvent.site/" },
  } });
  assert.equal(displayName(r.profile), "Alex");
  assert.equal(displayName({ ...r.profile, first_name: "" }), "@alex_1");
  assert.equal(linkUrl("telegram", "alex_tg"), "https://t.me/alex_tg");
});

test("cleanProfile rejects bad input", () => {
  for (const bad of [
    null, { nickname: "ab" }, { nickname: "has space" }, { nickname: "x".repeat(21) }, { first_name: "x".repeat(61) },
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
