"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRandomVisual, EVENT_FONTS, EVENT_LAYOUTS, EVENT_THEMES, eventPalettes, resolveEventVisual, shuffleEventVisual, withVisualOptions, type EventThemeId, type EventVisualConfig } from "@/lib/event-visuals";
import { EventPoster } from "@/components/EventVisual";

const SHUFFLE_ICON = "M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5";

function ThemeMark({ visual, className = "" }: { visual: EventVisualConfig; className?: string }) {
  const { theme, colors, backgroundAsset, backgroundPosition, backgroundSize } = resolveEventVisual(visual);
  const icon = "icon" in theme ? theme.icon : undefined;
  return (
    <span
      className={`flex items-center justify-center overflow-hidden text-[10px] font-bold text-white ${className}`}
      style={backgroundAsset
        ? { backgroundImage: `linear-gradient(#0003, #0003), url("${backgroundAsset}")`, backgroundPosition, backgroundSize }
        : { background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]} 70%, ${colors[2]})` }}
    >
      {icon ? <img src={icon} alt="" aria-hidden="true" className={`h-5 w-5 object-contain ${theme.id === "near" ? "brightness-0 invert" : ""}`} /> : <span className="truncate px-1">{theme.mark}</span>}
    </span>
  );
}

function ShuffleIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={SHUFFLE_ICON} />
    </svg>
  );
}

/** The event poster, one theme button under it, and a panel with every theme. */
export function EventThemePicker({ value, title, coverUrl, onChange }: {
  value: EventVisualConfig;
  title: string;
  coverUrl?: string | null;
  onChange: (visual: EventVisualConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const selected = resolveEventVisual(value);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const down = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const pickTheme = (themeId: EventThemeId) => onChange(themeId === value.themeId ? shuffleEventVisual(value) : createRandomVisual(themeId));

  return (
    <div ref={root} className="relative space-y-3">
      <EventPoster title={title.trim() || "Your event title"} visual={value} coverUrl={coverUrl} className="aspect-square w-full rounded-2xl shadow-lg" />

      <div className="lu-field flex items-center overflow-hidden">
        <button ref={trigger} type="button" className="lu-hover flex min-w-0 flex-1 items-center gap-2.5 p-2 text-left" aria-label={`Theme: ${selected.theme.name}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
          <ThemeMark visual={value} className="h-9 w-12 shrink-0 rounded-lg" />
          <span className="min-w-0">
            <span className="block text-xs text-muted">Theme</span>
            <span className="block truncate text-sm font-medium">{selected.theme.name}</span>
          </span>
        </button>
        <button type="button" className="lu-hover flex h-[52px] w-11 shrink-0 items-center justify-center text-muted" aria-label="Change theme variant" title="Change variant" onClick={() => onChange(shuffleEventVisual(value))}>
          <ShuffleIcon />
        </button>
      </div>

      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Theme"
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[62vh] space-y-4 overflow-y-auto rounded-t-2xl border border-border bg-surface p-4 text-text shadow-2xl outline-none md:absolute md:inset-x-auto md:bottom-auto md:left-full md:top-0 md:ml-3 md:!mt-0 md:max-h-[calc(100vh-6rem)] md:w-[min(560px,calc(100vw-23rem))] md:rounded-2xl"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Theme</span>
            <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-text" aria-label="Close" onClick={() => { setOpen(false); trigger.current?.focus(); }}>
              ✕
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-5">
            {EVENT_THEMES.map((theme) => {
              const active = value.themeId === theme.id;
              return (
                <button key={theme.id} type="button" aria-pressed={active} className="min-w-0 space-y-1 text-center" onClick={() => pickTheme(theme.id)}>
                  <ThemeMark visual={active ? value : { themeId: theme.id, seed: 0 }} className={`h-12 w-full rounded-lg ring-offset-2 ring-offset-surface ${active ? "ring-2 ring-text" : "hover:opacity-80"}`} />
                  <span className={`block truncate text-xs ${active ? "font-medium" : "text-muted"}`}>{theme.name}</span>
                </button>
              );
            })}
          </div>

          <Setting label="Color">
            {eventPalettes(value.themeId).map((colors, index) => (
              <button key={colors[1]} type="button" aria-label={`Color ${index + 1}`} aria-pressed={selected.variant === index} onClick={() => onChange(withVisualOptions(value, { variant: index }))}
                className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-surface ${selected.variant === index ? "ring-2 ring-text" : ""}`}
                style={{ background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]} 60%, ${colors[2]})` }} />
            ))}
          </Setting>

          <Setting label="Font">
            {EVENT_FONTS.map((fontFamily, index) => (
              <Option key={fontFamily} label={`Font ${index + 1}`} active={selected.font === index} onClick={() => onChange(withVisualOptions(value, { font: index }))}>
                <span style={{ fontFamily }}>Aa</span>
              </Option>
            ))}
          </Setting>

          <Setting label="Display">
            {EVENT_LAYOUTS.map((layout, index) => (
              <Option key={layout} label={`Title ${layout}`} active={selected.layout === layout} onClick={() => onChange(withVisualOptions(value, { layout: index }))}>
                <span className="capitalize">{layout}</span>
              </Option>
            ))}
          </Setting>
        </div>
      )}
    </div>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="label w-14 shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Option({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`rounded-lg px-2.5 py-1 text-sm ${active ? "bg-text text-bg" : "lu-pill !h-auto text-muted"}`}>
      {children}
    </button>
  );
}
