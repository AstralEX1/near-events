import assert from "node:assert/strict";
import test from "node:test";
import {
  EVENT_THEME_GROUPS,
  EVENT_THEMES,
  fallbackEventVisual,
  isEventThemeId,
  resolveEventVisual,
  validEventVisual,
} from "../src/lib/event-visuals.ts";

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
