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

test("Nearvent is the first collection with six own themes", () => {
  assert.deepEqual(EVENT_THEME_GROUPS[0], { id: "near-me", label: "Nearvent" });
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

test("saved legacy themes resolve exactly as before the Nearvent collection", () => {
  // Ethereum, NEAR, Claude and Cursor were deliberately restyled with their official marks and palettes (2026-11-09),
  // so they are not pinned here; the next test pins how every theme maps a saved seed.
  // Re-recorded without the font on 2026-11-10 (themes no longer change it); everything else matched the old pins.
  // Recorded before adding the new collection. These cover each palette, layout,
  // font and Paradise photo, plus a large seed and the maximum stored seed.
  const seeds = [0, 1, 2, 16, 32, 256, 512, 768, 1024, 1280, 4096, 8192, 12288, 123456789, 0xffff_ffff];
  const expected = {
    bitcoin: "56ad08c1012d2e972dcd59632a653c3c221ba0dd23f246d33fa2b5007e0526cf",
    base: "bc24c1721d2b1ee6f6399def0b34af91cef2cb203d5e24c107968bca03f5d936",
    solana: "a2006665845a13bd833c5f317fd8e2781155daca94dffbdf4331087d692ab6ba",
    paradise: "63a1d42d6b40a3ce615bb4e8cbb23d4c0febc4bf575927141d84f7f57400c5f3",
    codex: "003aea0dcd11f85ac0f1c0039f6f3dbdb8df03e65f3c5a82000eaaf02d3192cb",
    grok: "ca5da53a974e826b0e86e1414eff691612141321ff99db38767de8b76326171a",
    hermes: "1eb670b77779d4adc31c9e0599af5d50ce3f60184ec907fe368354a5c7c0e105",
  };

  for (const [themeId, digest] of Object.entries(expected)) {
    // `theme` is the catalog entry (name, note, mark); the font is now always the site font (checked below), so neither is pinned.
    const visuals = seeds.map((seed) => { const { font: _font, fontFamily, theme: _theme, ...visual } = resolveEventVisual({ themeId, seed }); assert.equal(fontFamily, "var(--font-display)"); return visual; });
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

test("withVisualOptions changes one choice and keeps the others", async () => {
  const { EVENT_FONTS, EVENT_LAYOUTS, resolveEventVisual, validEventVisual, withVisualOptions } = await import("../src/lib/event-visuals.ts");
  for (const seed of [0, 1, 0xffff_ffff, 0xa5a5a5a5, 123456789]) {
    const before = resolveEventVisual({ themeId: "paradise", seed });
    const keep = (after, ...fields) => assert.deepEqual(fields.map((f) => after[f]), fields.map((f) => before[f]));
    for (let variant = 0; variant < 3; variant++) {
      const config = withVisualOptions(before.config, { variant });
      assert.ok(validEventVisual(config));
      const after = resolveEventVisual(config);
      assert.equal(after.variant, variant);
      keep(after, "font", "layout", "backgroundAsset");
    }
    EVENT_FONTS.forEach((_, font) => {
      const after = resolveEventVisual(withVisualOptions(before.config, { font }));
      assert.equal(after.font, font);
      keep(after, "variant", "layout", "backgroundAsset");
    });
    EVENT_LAYOUTS.forEach((layout, index) => {
      const after = resolveEventVisual(withVisualOptions(before.config, { layout: index }));
      assert.equal(after.layout, layout);
      keep(after, "variant", "font", "backgroundAsset");
    });
  }
});

test("shuffleEventVisual gives a visibly different look of the same theme", async () => {
  const { resolveEventVisual, shuffleEventVisual } = await import("../src/lib/event-visuals.ts");
  for (const seed of [0, 1, 0xffff_ffff, 123456789]) {
    const near = shuffleEventVisual({ themeId: "near", seed });
    assert.equal(near.themeId, "near");
    assert.notEqual(resolveEventVisual(near).variant, resolveEventVisual({ themeId: "near", seed }).variant);
    const paradise = shuffleEventVisual({ themeId: "paradise", seed });
    assert.notEqual(resolveEventVisual(paradise).backgroundAsset, resolveEventVisual({ themeId: "paradise", seed }).backgroundAsset);
  }
});

test("every theme, including the restyled and newer ones, maps a saved seed the same way", () => {
  for (const theme of EVENT_THEMES) {
    for (const seed of [0, 1, 2, 16, 256, 4096, 123456789, 0xffff_ffff]) {
      const look = resolveEventVisual({ themeId: theme.id, seed });
      assert.equal(look.variant, seed % 3, theme.id);
      assert.equal(look.layout, ["center", "lower", "offset"][(seed >>> 4) % 3], theme.id);
      assert.equal(look.font, (seed >>> 12) % 4, theme.id);
    }
  }
});

test("unsaved events keep their fallback theme after new themes were added", async () => {
  const { fallbackEventVisual } = await import("../src/lib/event-visuals.ts");
  const legacy = ["ethereum", "bitcoin", "base", "near", "solana", "paradise", "claude", "codex", "cursor", "grok", "hermes"];
  for (let id = 0; id < 40; id++) assert.ok(legacy.includes(fallbackEventVisual(id, `Event ${id}`).themeId));
});

test("generated art is stable per seed and Regenerate changes only the art bits", async () => {
  const { generativeArt, regenerateEventVisual, meshGradient } = await import("../src/lib/event-visuals.ts");
  for (const theme of EVENT_THEMES) {
    const visual = { themeId: theme.id, seed: 0x1234_5678 };
    if (resolveEventVisual(visual).backgroundAsset) {
      assert.deepEqual(regenerateEventVisual(visual), visual, theme.id);
      continue;
    }
    assert.equal(generativeArt(visual), generativeArt({ ...visual }), theme.id);
    const next = regenerateEventVisual(visual);
    assert.equal(next.themeId, theme.id);
    assert.notEqual(next.seed >>> 16, 0x1234, theme.id);
    assert.notEqual(generativeArt(next), generativeArt(visual), theme.id);
    const a = resolveEventVisual(visual), b = resolveEventVisual(next);
    assert.deepEqual([b.variant, b.layout, b.font, b.backgroundAsset], [a.variant, a.layout, a.font, a.backgroundAsset]);
  }
  assert.notEqual(meshGradient(1, ["red"]), meshGradient(2, ["red"]));
  assert.ok(!meshGradient(0, ["red", "blue"]).includes("NaN"));
});
