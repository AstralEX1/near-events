"use client";

import { useEffect, useState } from "react";
import { createRandomVisual, EVENT_THEME_GROUPS, EVENT_THEMES, resolveEventVisual, type EventThemeGroup, type EventVisualConfig } from "@/lib/event-visuals";
import { EventPoster } from "@/components/EventVisual";

export function EventThemePicker({ value, title, coverUrl, onChange }: {
  value: EventVisualConfig;
  title: string;
  coverUrl?: string | null;
  onChange: (visual: EventVisualConfig) => void;
}) {
  const [group, setGroup] = useState<EventThemeGroup>("near-me");
  const [open, setOpen] = useState(false);
  const selected = resolveEventVisual(value);
  useEffect(() => setGroup(selected.theme.group), [selected.theme.group]);
  const options = EVENT_THEMES.filter((theme) => theme.group === group);
  const heading = title.trim() || "Your event title";

  return (
    <section className="space-y-4" aria-label="Event theme">
      <EventPoster title={heading} visual={value} coverUrl={coverUrl} className="aspect-square w-full rounded-3xl" />
      <div className="flex items-center justify-between gap-3">
        <div><div className="text-sm font-medium">{selected.theme.name}</div><p className="text-xs text-muted">Your event, your look</p></div>
        <button id="event-theme-toggle" type="button" className="btn btn-ghost text-sm" aria-expanded={open} aria-controls="event-theme-options" onClick={() => setOpen(!open)}>{open ? "Done" : "Change theme"}</button>
      </div>

      <div id="event-theme-options" hidden={!open} className="space-y-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Event look</div>
              <p className="text-xs text-muted mt-0.5">Background and cover · you can change this later</p>
            </div>
            <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={() => onChange(createRandomVisual(value.themeId))}>
              Shuffle
            </button>
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
              const iconClass = theme.id === "near" ? "brightness-0 invert" : "";
              return (
                <button key={theme.id} type="button" aria-pressed={active} onClick={() => onChange(createRandomVisual(theme.id))}
                  className={`rounded-xl border p-2.5 text-left transition ${active ? "border-accent ring-1 ring-accent" : "border-border hover:border-muted"}`}>
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: theme.group === "near-me" ? colors[1] : `linear-gradient(140deg, ${colors[0]}, ${colors[1]})`, color: theme.group === "near-me" ? colors[0] : undefined }}>
                      {icon ? <img src={icon} alt="" aria-hidden="true" className={`h-5 w-5 object-contain ${iconClass}`} /> : theme.group === "near-me" ? "n" : theme.mark}
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
      </div>
    </section>
  );
}
