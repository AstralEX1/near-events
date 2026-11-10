"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createRandomVisual, EVENT_LAYOUTS, EVENT_THEMES, eventPalettes, regenerateEventVisual, resolveEventVisual, shuffleEventVisual, withVisualOptions, type EventThemeId, type EventVisualConfig } from "@/lib/event-visuals";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";

/** A small preview of a theme: its background with "Title", like Luma's tiles. */
function ThemeTile({ visual, className = "" }: { visual: EventVisualConfig; className?: string }) {
  const { theme, colors, fontFamily } = resolveEventVisual(visual);
  const ink = theme.group === "near-me" && theme.id !== "photo" ? colors[0] : "#fff";
  return (
    <VisualBackdrop visual={visual} className={className}>
      <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold leading-none tracking-tight" style={{ fontFamily, color: ink }}>Title</span>
    </VisualBackdrop>
  );
}

/** Downscale and re-encode to JPEG so uploads stay small (server accepts up to 600 KB). */
async function toJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [side, quality] of [[1600, 0.85], [1200, 0.8], [900, 0.75]] as const) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length * 0.75 < 580_000) return url;
  }
  throw new Error("This photo is too large. Try a smaller one.");
}

/** The event poster with a photo button, one Theme field under it, and a Luma-style theme drawer. */
export function EventThemePicker({ value, title, coverUrl, photo, onPhoto, onChange }: {
  value: EventVisualConfig;
  title: string;
  coverUrl?: string | null;
  photo?: string | null;
  onPhoto?: (photo: string | null) => void;
  onChange: (visual: EventVisualConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = resolveEventVisual(value);
  const nearMe = selected.theme.group === "near-me";

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const down = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Drag to dismiss. The sheet tracks the pointer 1:1; on release it either snaps back or closes,
  // judged by where the gesture would come to rest (Apple's projection, deceleration 0.998).
  const drag = useRef<{ y: number; t: number; v: number; dy: number } | null>(null);
  const dragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button") || !panel.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, t: e.timeStamp, v: 0, dy: 0 };
    panel.current.style.transition = "none";
  };
  const dragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !panel.current) return;
    const dy = e.clientY - d.y;
    if (e.timeStamp > d.t) d.v = ((dy - d.dy) / (e.timeStamp - d.t)) * 1000;
    d.dy = dy;
    d.t = e.timeStamp;
    // Upward there is nothing more to show: resist instead of stopping dead.
    panel.current.style.transform = `translateY(${dy >= 0 ? dy : -12 * Math.log1p(-dy / 12)}px)`;
  };
  const dragEnd = () => {
    const d = drag.current;
    const el = panel.current;
    drag.current = null;
    if (!d || !el) return;
    // Hand back to the CSS transition, which animates from where the finger left the sheet.
    el.style.transition = "";
    el.style.transform = "";
    if (d.dy + (d.v / 1000) * 0.998 / (1 - 0.998) > el.offsetHeight / 2) setOpen(false);
  };

  const pickTheme = (themeId: EventThemeId) => onChange(themeId === value.themeId ? shuffleEventVisual(value) : createRandomVisual(themeId));
  const pickPhoto = async (file: File | undefined) => {
    if (!file || !onPhoto) return;
    setPhotoError(null);
    try {
      onPhoto(await toJpeg(file));
    } catch (error) {
      setPhotoError(error instanceof Error && error.message.startsWith("This photo") ? error.message : "Could not read this image. Try a JPEG or PNG.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <EventPoster key={photo ?? coverUrl ?? `${value.themeId}:${value.seed}`} title={title.trim() || "Your event title"} visual={value} coverUrl={photo ?? coverUrl} className="gc-poster aspect-square w-full rounded-3xl shadow-lg" />
        {onPhoto && (
          <div className="absolute bottom-3 right-3 flex gap-2">
            {photo && (
              <button type="button" className="gc-icon-button" aria-label="Remove cover photo" onClick={() => onPhoto(null)}>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
            <button type="button" className="gc-icon-button" aria-label={photo ? "Change cover photo" : "Upload cover photo"} data-tooltip={photo ? "Change cover photo" : "Upload your own photo"} onClick={() => fileInput.current?.click()}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></svg>
            </button>
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { void pickPhoto(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
        )}
      </div>
      {photoError && <p className="text-xs text-danger" role="alert">{photoError}</p>}

      <button ref={trigger} type="button" className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-2 text-left shadow-sm" aria-label={`Theme: ${selected.theme.name}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ThemeTile visual={value} className="h-10 w-14 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted">Theme</span>
          <span className="block truncate text-sm font-medium">{selected.theme.name}</span>
        </span>
        <svg viewBox="0 0 24 24" className="mr-1 h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" /></svg>
      </button>

      <div ref={panel} role="dialog" aria-label="Theme" aria-hidden={!open} inert={!open} tabIndex={-1} data-open={open} className="gc-theme-drawer outline-none">
        <div className="mx-auto max-w-[920px] space-y-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          {/* Grab the top strip to pull the sheet down; it follows the finger and a flick closes it. */}
          <div className="gc-sheet-handle -mx-4 px-4 pt-2 sm:-mx-6 sm:px-6" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
            <div className="gc-grabber" aria-hidden="true" />
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-semibold">Theme</span>
              <button type="button" className="lu-pill rounded-full !h-8 text-sm" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Done</button>
            </div>
          </div>

          <div className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-3 pt-1 sm:-mx-6 sm:px-6" role="listbox" aria-label="Themes">
            {EVENT_THEMES.map((theme) => {
              const active = value.themeId === theme.id;
              return (
                <button key={theme.id} type="button" role="option" aria-selected={active} data-tooltip={active ? "Click again for another variant" : theme.note} className="gc-theme-tile w-[76px] shrink-0 snap-start space-y-1.5 text-center" onClick={() => pickTheme(theme.id)}>
                  <ThemeTile visual={active ? value : { themeId: theme.id, seed: 0 }} className={`h-[60px] w-full rounded-xl ring-offset-2 ring-offset-surface ${active ? "ring-2 ring-text" : ""}`} />
                  <span className={`block truncate text-xs ${active ? "font-semibold" : "text-muted"}`}>{theme.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-3">
            {!selected.backgroundAsset && (
              <Setting label="Background">
                <Option label="Regenerate background" active={false} onClick={() => onChange(regenerateEventVisual(value))}>
                  <span className="inline-flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4" /></svg>
                    Regenerate
                  </span>
                </Option>
              </Setting>
            )}
            <Setting label="Color">
              {eventPalettes(value.themeId).map((colors, index) => (
                <button key={index} type="button" aria-label={`Color ${index + 1}`} aria-pressed={selected.variant === index} onClick={() => onChange(withVisualOptions(value, { variant: index }))}
                  className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-surface ${selected.variant === index ? "ring-2 ring-text" : ""}`}
                  style={{ background: `linear-gradient(140deg, ${colors[0]}, ${colors[1]} 60%, ${colors[2]})` }} />
              ))}
            </Setting>
            {!nearMe && (
              <>
                <Setting label="Display">
                  {EVENT_LAYOUTS.map((layout, index) => (
                    <Option key={layout} label={`Title ${layout}`} active={selected.layout === layout} onClick={() => onChange(withVisualOptions(value, { layout: index }))}>
                      <span className="capitalize">{layout}</span>
                    </Option>
                  ))}
                </Setting>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5" role="group" aria-label={label}>
      <span className="text-xs text-muted">{label}</span>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function Option({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`h-8 rounded-full px-3 text-xs transition-transform duration-150 ease-out active:scale-[.97] ${active ? "bg-text text-bg" : "lu-pill !h-8 text-muted"}`}>
      {children}
    </button>
  );
}
