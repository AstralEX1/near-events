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
  // Ethereum, NEAR, Claude and Cursor were deliberately restyled with their official marks and palettes (2026-11-09),
  // so they are not pinned here; the next test pins how every theme maps a saved seed.
  // Recorded before adding the new collection. These cover each palette, layout,
  // font and Paradise photo, plus a large seed and the maximum stored seed.
  const seeds = [0, 1, 2, 16, 32, 256, 512, 768, 1024, 1280, 4096, 8192, 12288, 123456789, 0xffff_ffff];
  const expected = {
    bitcoin: "6c75d2802d6e792ab35f96beca689350ec04b055fd95977e1b652ab8eccb4ba9",
    base: "fcb69b98017de604b0b4b56770e2f55a93dfc0587003c7a5fa98b6825d9bfd33",
    solana: "307791ba9d626cdf9cd2f2cc21021d0c7921d0d21c54550868f9395837b0986d",
    paradise: "a747c0089defede262970a1c152ef610658af6a40458a92588fa099179383a0c",
    codex: "06519b192c3be71aa9ef8310165ffdd66b1627c9c8b660ad427877375b7d8fa4",
    grok: "e49fe376f11896532bdc344b9caa3964c0b660abd5c9ba3d0eb6906824309a49",
    hermes: "053521e1a06ee9441eb3a5f942085e942bdd2eb6d76c75a1b14c5fea5e34024d",
  };

  for (const [themeId, digest] of Object.entries(expected)) {
    // `font` is the index behind fontFamily and `theme` is the catalog entry (name, note, mark); neither changes how a saved look is drawn.
    const visuals = seeds.map((seed) => { const { font: _font, theme: _theme, ...visual } = resolveEventVisual({ themeId, seed }); return visual; });
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
