import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_FONTS, EVENT_LAYOUTS, resolveEventVisual, shuffleEventVisual, validEventVisual, withVisualOptions } from "../src/lib/event-visuals.ts";

const SEEDS = [0, 1, 0xffff_ffff, 0xa5a5a5a5, 123456789];

test("withVisualOptions changes one choice and keeps the others", () => {
  for (const seed of SEEDS) {
    const before = resolveEventVisual({ themeId: "paradise", seed });
    for (let variant = 0; variant < 3; variant++) {
      const config = withVisualOptions(before.config, { variant });
      const after = resolveEventVisual(config);
      assert.ok(validEventVisual(config));
      assert.equal(after.variant, variant);
      assert.deepEqual([after.font, after.layout, after.backgroundAsset], [before.font, before.layout, before.backgroundAsset]);
    }
    EVENT_FONTS.forEach((_, font) => {
      const after = resolveEventVisual(withVisualOptions(before.config, { font }));
      assert.equal(after.font, font);
      assert.deepEqual([after.variant, after.layout, after.backgroundAsset], [before.variant, before.layout, before.backgroundAsset]);
    });
    EVENT_LAYOUTS.forEach((layout, index) => {
      const after = resolveEventVisual(withVisualOptions(before.config, { layout: index }));
      assert.equal(after.layout, layout);
      assert.deepEqual([after.variant, after.font, after.backgroundAsset], [before.variant, before.font, before.backgroundAsset]);
    });
  }
});

test("shuffleEventVisual always gives a visibly different look of the same theme", () => {
  for (const seed of SEEDS) {
    const near = shuffleEventVisual({ themeId: "near", seed });
    assert.equal(near.themeId, "near");
    assert.notEqual(resolveEventVisual(near).variant, resolveEventVisual({ themeId: "near", seed }).variant);
    const paradise = shuffleEventVisual({ themeId: "paradise", seed });
    assert.notEqual(resolveEventVisual(paradise).backgroundAsset, resolveEventVisual({ themeId: "paradise", seed }).backgroundAsset);
  }
});
