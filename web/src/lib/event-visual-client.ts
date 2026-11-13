"use client";

import { useEffect, useState } from "react";
import { fallbackEventVisual, type EventVisualConfig } from "./event-visuals";

const cache = new Map<number, EventVisualConfig | null>();
const listeners = new Map<number, Set<(visual: EventVisualConfig | null) => void>>();
const pending = new Set<number>();
const covers = new Map<number, string>();
let scheduled = false;

function publish(id: number, visual: EventVisualConfig | null) {
  cache.set(id, visual);
  for (const listener of listeners.get(id) ?? []) listener(visual);
}

function scheduleBatch() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void flushBatch());
}

async function flushBatch() {
  scheduled = false;
  const ids = [...pending].slice(0, 50);
  ids.forEach((id) => pending.delete(id));
  if (!ids.length) return;
  try {
    const response = await fetch(`/api/event-visuals?ids=${encodeURIComponent(ids.join(","))}`, { cache: "no-store" });
    if (!response.ok) throw new Error("visual lookup failed");
    const body = await response.json() as { visuals?: Record<string, EventVisualConfig>; covers?: Record<string, string> };
    for (const id of ids) {
      const cover = body.covers?.[String(id)];
      if (cover) covers.set(id, cover); // before publish, so the re-render it causes sees the cover
      publish(id, body.visuals?.[String(id)] ?? null);
    }
  } catch {
    for (const id of ids) publish(id, null);
  }
  if (pending.size) scheduleBatch();
}

function subscribe(id: number, listener: (visual: EventVisualConfig | null) => void) {
  if (cache.has(id)) {
    listener(cache.get(id) ?? null);
    return () => {};
  }
  const group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  pending.add(id);
  scheduleBatch();
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(id);
  };
}

/** The host's cover photo, if any; filled by the batch useEventVisual waits for. */
export const eventCover = (id: number) => covers.get(id) ?? null;

export function rememberEventVisual(id: number, visual: EventVisualConfig) {
  publish(id, visual);
}

export function useEventVisual(id: number, title: string): EventVisualConfig {
  const [visual, setVisual] = useState(() => fallbackEventVisual(id, title));
  useEffect(() => {
    setVisual(fallbackEventVisual(id, title));
    return subscribe(id, (saved) => setVisual(saved ?? fallbackEventVisual(id, title)));
  }, [id, title]);
  return visual;
}
