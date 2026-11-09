import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  EVENT_THEME_GROUPS,
  EVENT_THEMES,
  createRandomEventVisual,
  fallbackEventVisual,
  isEventThemeId,
  resolveEventVisual,
  validEventVisual,
} from "../src/lib/event-visuals.ts";

test("new events start with Studio and retain a fresh seed", (t) => {
  const seeds = [17, 901];
  t.mock.method(globalThis.crypto, "getRandomValues", (values) => {
    values[0] = seeds.shift();
    return values;
  });

  assert.deepEqual(createRandomEventVisual(), { themeId: "studio", seed: 17 });
  assert.deepEqual(createRandomEventVisual(), { themeId: "studio", seed: 901 });
});

test("Near Me is the first collection with six own themes", () => {
  assert.deepEqual(EVENT_THEME_GROUPS[0], { id: "near-me", label: "Near Me" });
  assert.deepEqual(
    EVENT_THEMES.filter((theme) => theme.group === "near-me").map((theme) => theme.id),
    ["studio", "garden", "sunset", "afterhours", "paper", "photo"],
  );
});

test("adding collections preserves fallback looks for existing events", () => {
  const fixtures = [
    [0, "", { themeId: "codex", seed: 2654435769 }],
    [1, "Bali breakfast", { themeId: "hermes", seed: 277638019 }],
    [4, "Near Me", { themeId: "ethereum", seed: 2487258015 }],
    [42, "Community dinner", { themeId: "hermes", seed: 717829232 }],
    [100, "Встреча друзей", { themeId: "hermes", seed: 3634390594 }],
  ];
  for (const [eventId, title, expected] of fixtures) {
    assert.deepEqual(fallbackEventVisual(eventId, title), expected);
  }
});

test("saved legacy themes resolve exactly as before the Near Me collection", () => {
  // Recorded before adding the new collection. These cover each palette, layout,
  // font and Paradise photo, plus a large seed and the maximum stored seed.
  const seeds = [0, 1, 2, 16, 32, 256, 512, 768, 1024, 1280, 4096, 8192, 12288, 123456789, 0xffff_ffff];
  const expected = {
    ethereum: "1cfb91e170a4a1f0c44ab950872a81cc08cafb2b28f4fe7741715a04b4e548ba",
    bitcoin: "24b8a20fafa66d70c2ae5b77e51392bd79c60f6ba2da4a94552fda643a49d66a",
    base: "f0d2dc03bfa109324d35efb4e2e1e045daff362b89dd3c29f2fada0d6740d56b",
    near: "b4919f83c2dd719df0b327a98d32f4fb195ea3672f1087b7c72c3ffd1a948648",
    solana: "5c3fc9ab092a6a6f86349f896a4817a3c3cf9a50c4b4852c30fea682464345be",
    paradise: "fff7447e166aeabad7e2a25e62b178f763a05fd58179148d64a35a44e973f054",
    claude: "fcf900f2aeaac0a274acfec25cf50a83dbd8b93dbc18c8c73c1661606c7d2e2c",
    codex: "ea199b01f8f7108b5e09c7881b90513d0475de56ec897e3f2d7fd1eeb4bd2dee",
    cursor: "a7259a8621e75427cdd549ae5a5e32ce0c8ee6e1535b11eef8f75532bbf5b486",
    grok: "8226de278cb2734b7899857343bac4cb0609b60f5cc231dca8f7039535d3a019",
    hermes: "674ed70abef44b997a289332193b1c2c7934c95ea82360d9faa904c2a473f179",
  };

  for (const [themeId, digest] of Object.entries(expected)) {
    const visuals = seeds.map((seed) => resolveEventVisual({ themeId, seed }));
    assert.equal(createHash("sha256").update(JSON.stringify(visuals)).digest("hex"), digest, themeId);
  }
});

test("every event theme belongs to a picker group and resolves consistently", () => {
  const groups = new Set(EVENT_THEME_GROUPS.map((group) => group.id));

  for (const theme of EVENT_THEMES) {
    assert.ok(groups.has(theme.group));
    assert.ok(isEventThemeId(theme.id));

    const config = { themeId: theme.id, seed: 123456789 };
    const first = resolveEventVisual(config);
    const second = resolveEventVisual(config);

    assert.ok(validEventVisual(config));
    assert.equal(first.theme.id, theme.id);
    assert.deepEqual(first, second);
    assert.equal(first.colors.length, 3);
    assert.ok(first.texture.length > 0);
  }
});

test("event visual validation and fallback selection stay deterministic", () => {
  assert.equal(isEventThemeId("not-a-theme"), false);
  assert.equal(validEventVisual({ themeId: "near", seed: -1 }), false);
  assert.equal(validEventVisual({ themeId: "near", seed: 0x1_0000_0000 }), false);
  assert.equal(validEventVisual({ themeId: "not-a-theme", seed: 1 }), false);
  assert.equal(validEventVisual({ themeId: "near", seed: 0xffff_ffff }), true);

  const fallback = fallbackEventVisual(42, "Community dinner");
  assert.ok(validEventVisual(fallback));
  assert.deepEqual(fallback, fallbackEventVisual(42, "Community dinner"));
});
