"use client";

import { useEffect, useState } from "react";
import { createRandomVisual, EVENT_THEME_GROUPS, EVENT_THEMES, resolveEventVisual, type EventThemeGroup, type EventVisualConfig } from "@/lib/event-visuals";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";

export function EventThemePicker({ value, title, coverUrl, onChange }: {
  value: EventVisualConfig;
  title: string;
  coverUrl?: string | null;
  onChange: (visual: EventVisualConfig) => void;
}) {
  const [group, setGroup] = useState<EventThemeGroup>("blockchain");
  const selected = resolveEventVisual(value);
  useEffect(() => setGroup(selected.theme.group), [selected.theme.group]);
  const options = EVENT_THEMES.filter((theme) => theme.group === group);
  const heading = title.trim() || "Your event title";

  return (
    <section className="space-y-3" aria-label="Event theme">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="label">Event look</div>
          <p className="text-sm text-muted mt-0.5">Background and title cover · change until you publish</p>
        </div>
        <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={() => onChange(createRandomVisual(value.themeId))}>
          ↻ Shuffle
        </button>
      </div>

      <div className="grid grid-cols-[1fr_9rem] sm:grid-cols-[1fr_12rem] gap-2">
        <VisualBackdrop visual={value} className="h-36 sm:h-44 rounded-xl p-3 flex items-end text-white">
          <div className="relative rounded-lg bg-black/30 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium">
            {selected.theme.group === "paradise" ? "Paradise background · Bali & islands" : `${selected.theme.name} background`}
          </div>
        </VisualBackdrop>
        <EventPoster title={heading} visual={value} coverUrl={coverUrl} className="aspect-square rounded-xl shadow-sm" />
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Theme collection">
        {EVENT_THEME_GROUPS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={group === item.id} onClick={() => setGroup(item.id)}
            className={`rounded-full px-3 py-1.5 text-sm whitespace-nowrap ${group === item.id ? "bg-text text-bg" : "bg-border/50 text-muted hover:text-text"}`}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {options.map((theme) => {
          const active = value.themeId === theme.id;
          const colors = resolveEventVisual({ themeId: theme.id, seed: value.seed }).colors;
          const icon = "icon" in theme ? theme.icon : undefined;
          return (
            <button key={theme.id} type="button" aria-pressed={active} onClick={() => onChange(createRandomVisual(theme.id))}
              className={`rounded-xl border p-2.5 text-left transition ${active ? "border-accent ring-1 ring-accent" : "border-border hover:border-muted"}`}>
              <span className="flex items-center gap-2 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]})` }}>
                  {icon ? <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 object-contain brightness-0 invert" /> : theme.mark}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{theme.name}</span>
                  <span className="block truncate text-[11px] text-muted">{theme.note}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
