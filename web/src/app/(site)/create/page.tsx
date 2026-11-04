"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { events, toUnits, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Cover } from "@/components/ui";
import { Themed } from "@/components/Themed";
import { COLORS, FONTS, THEMES, decodeTheme, defaultTheme, encodeTheme, shuffleTheme, themeCover, themeStyle, type FontKey, type Theme, type ThemeName } from "@/lib/theme";
import { SignInOptions } from "@/components/SignIn";
import { LOCAL_TZ, city, dayLabel, fromEpoch, gmtLabel, toEpoch } from "@/lib/time";


const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

interface When {
  start: number;
  end: number;
  tz: string;
}

/**
 * Create an event the way Luma lays it out: cover and theme on the left; on
 * the right the name typed big, a Start/End block with its time zone, place,
 * description, then the options as one stack of rows. A Luma link fills it
 * all in, so a host can move registration here in one paste.
 */
export default function CreateEvent() {
  const { accountId, send } = useWallet();
  const [form, setForm] = useState({ title: "", description: "", location: "", deposit: "10", capacity: "50", cohosts: "" });
  const [when, setWhen] = useState<When | null>(null);
  const [theme, setTheme] = useState<Theme>(defaultTheme("ambient"));
  const [themeOpen, setThemeOpen] = useState(false);
  const [lumaOpen, setLumaOpen] = useState(false);
  const [lumaUrl, setLumaUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EventView | null>(null);

  // "Duplicate event" (Luma, Hi.Events): /create?from=<id> copies everything but the date.
  useEffect(() => {
    const from = Number(new URLSearchParams(window.location.search).get("from"));
    if (!Number.isInteger(from) || !window.location.search.includes("from=")) return;
    events.get(from).then((e) => {
      if (!e) return;
      setForm((f) => ({
        ...f,
        title: e.metadata.title,
        description: e.metadata.description,
        location: e.metadata.location,
        deposit: String(Number(e.deposit) / 1e6),
        capacity: String(e.capacity),
        cohosts: e.cohosts.join(", "),
      }));
      setTheme(decodeTheme(e.metadata.cover_url));
    });
  }, []);

  // Default to tomorrow, on the hour, for two hours (set on the client, not during prerender).
  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setMinutes(0, 0, 0);
    setWhen((w) => w ?? { start: start.getTime(), end: start.getTime() + 2 * 3600_000, tz: LOCAL_TZ });
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const importLuma = async () => {
    setImporting(true);
    setError(null);
    try {
      const r = await fetch(`/api/luma/import?url=${encodeURIComponent(lumaUrl)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      setForm((f) => ({ ...f, title: j.title, description: j.description, location: j.location }));
      setWhen((w) => ({ tz: w?.tz ?? LOCAL_TZ, start: new Date(j.starts_at).getTime(), end: new Date(j.ends_at).getTime() }));
      if (j.cover_url) setTheme((t) => ({ ...t, image: j.cover_url }));
      setImported(j.luma_url);
      setLumaOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when) return;
    if (when.end <= when.start) return setError("The event has to end after it starts.");
    setBusy(true);
    setError(null);
    try {
      const capacity = Number(form.capacity);
      const storage = BigInt(await events.storageCost(capacity));
      const title = form.title.trim();
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              description: form.description.trim(),
              location: form.location.trim(),
              cover_url: encodeTheme(theme),
              starts_at: when.start,
              ends_at: when.end,
            },
            deposit: toUnits(form.deposit),
            capacity,
            cohosts: form.cohosts.split(/[\s,]+/).filter(Boolean),
          },
          deposit: storage,
        },
      ]);
      // The new event is the latest one this account created with this title.
      const latest = (await events.list()).find((ev) => ev.host === accountId && ev.metadata.title === title);
      if (latest) setCreated(latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) return <Created event={created} />;

  const preview = { id: 0, metadata: { title: form.title || "Event", cover_url: encodeTheme(theme) } } as EventView;

  return (
    <Themed theme={theme}>
      <form onSubmit={submit} className="max-w-[928px] mx-auto grid gap-8 md:grid-cols-[330px_1fr] items-start pb-40">
        {/* Left: cover, then theme + shuffle. */}
        <div className="space-y-4 md:sticky md:top-20">
          <div className="relative">
            <Cover event={preview} className="aspect-square w-full rounded-2xl [&>span]:hidden shadow-sm" />
            <button
              type="button"
              aria-label={theme.image ? "Change image" : "Add image"}
              onClick={() => setPicker(!picker)}
              className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/70 text-white flex items-center justify-center backdrop-blur ring-2 ring-white/80"
            >
              <Icon d="M4 16l4.5-4.5 3 3L16 10l4 4M4 5h16v14H4z" />
            </button>
          </div>
          {picker && (
            <div className="lu-field p-3 space-y-2">
              <input
                autoFocus
                className="w-full bg-transparent outline-none text-sm"
                type="url"
                maxLength={200}
                placeholder="Paste an image link (https://…)"
                value={theme.image ?? ""}
                onChange={(e) => setTheme((t) => ({ ...t, image: e.target.value.trim() || null }))}
              />
              <p className="text-xs text-muted">Leave empty to use the theme’s own cover.</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setThemeOpen(!themeOpen)} className="lu-field lu-hover flex-1 flex items-center gap-3 p-2 text-left">
              <span className="w-12 h-9 rounded-md overflow-hidden shrink-0" style={{ ...themeStyle(theme).vars, background: themeStyle(theme).background }}>
                <span className="block w-5 h-3.5 m-1.5 rounded-sm" style={{ background: themeCover(theme) }} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-muted">Theme</span>
                <span className="block font-medium truncate">{THEMES[theme.name].label}</span>
              </span>
              <Icon d="M8 9l4-4 4 4M8 15l4 4 4-4" className="text-muted" />
            </button>
            <button type="button" aria-label="Shuffle theme" onClick={() => setTheme(shuffleTheme(theme))} className="lu-field lu-hover w-[54px] flex items-center justify-center">
              <Icon d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l3 3-3 3M18 14l3 3-3 3" />
            </button>
          </div>
        </div>

        {/* Right: the event itself. */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="lu-chip">
              <span className="w-4 h-4 rounded-full" style={{ background: theme.color }} />
              {accountId ? <span className="truncate max-w-44">{accountId}</span> : "Your events"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className="lu-chip lu-hover" onClick={() => setLumaOpen(!lumaOpen)}>
                {imported ? "✓ Imported from Luma" : "Import from Luma"}
              </button>
              <span className="lu-chip" title="Every event is public in v1">
                <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" size={14} />
                Public
              </span>
            </div>
          </div>
          {lumaOpen && (
            <div className="lu-field p-2 flex gap-2">
              <input
                autoFocus
                className="flex-1 min-w-0 bg-transparent px-2 outline-none text-sm"
                placeholder="Paste your lu.ma link"
                value={lumaUrl}
                onChange={(e) => setLumaUrl(e.target.value)}
              />
              <button type="button" className="btn btn-primary !py-1.5 text-sm" disabled={!lumaUrl.trim() || importing} onClick={importLuma}>
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          )}

          <textarea
            required
            maxLength={120}
            rows={1}
            value={form.title}
            onChange={(e) => set("title")(e.target.value)}
            placeholder="Event Name"
            aria-label="Event name"
            className="w-full resize-none bg-transparent text-[40px] leading-[1.15] font-semibold tracking-tight outline-none placeholder:text-muted/50 [field-sizing:content]"
          />

          {when && <WhenBlock when={when} onChange={setWhen} />}

          <ExpandRow
            icon="M12 21s-7-6.2-7-11.5A7 7 0 0119 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"
            title="Add Event Location"
            hint="Offline location or virtual link"
            value={form.location}
          >
            {(close) => (
              <input
                autoFocus
                className="w-full bg-transparent outline-none"
                maxLength={300}
                value={form.location}
                onChange={(e) => set("location")(e.target.value)}
                onBlur={close}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), close())}
                placeholder="Address, venue or link"
              />
            )}
          </ExpandRow>

          <ExpandRow icon="M5 6h14M5 10h14M5 14h9M5 18h6" title="Add Description" value={form.description} multiline>
            {(close) => (
              <textarea
                autoFocus
                className="w-full bg-transparent outline-none min-h-28 resize-y"
                maxLength={2000}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
                onBlur={close}
                placeholder="Who should come, what happens, what to bring"
              />
            )}
          </ExpandRow>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium text-muted">Event Options</div>
            <div className="rounded-2xl overflow-hidden flex flex-col gap-px">
              <OptionRow
                icon="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4zM14 6v12"
                label="Deposit"
                value={`${form.deposit} USDC`}
                title="Deposit"
                help="Each guest puts this down. People who come get it back plus a share of the no-shows."
              >
                <input className="input" type="number" min="0.01" step="0.01" required value={form.deposit} onChange={(e) => set("deposit")(e.target.value)} />
              </OptionRow>
              <div className="lu-row">
                <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" className="text-muted" />
                <span className="flex-1">Show-ups split no-shows</span>
                <span className="text-muted text-sm">Always on</span>
              </div>
              <OptionRow
                icon="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8"
                label="Capacity"
                value={form.capacity}
                title="Max capacity"
                help="Up to 300 guests. Registration closes when it's full."
              >
                <input className="input" type="number" min="1" max="300" required value={form.capacity} onChange={(e) => set("capacity")(e.target.value)} />
              </OptionRow>
              <OptionRow
                icon="M9 11l2 2 4-4M4 4h16v16H4z"
                label="Door team"
                value={form.cohosts.trim() ? `${form.cohosts.split(/[\s,]+/).filter(Boolean).length} people` : "Just you"}
                title="Door team"
                help="NEAR accounts that can check guests in, separated by commas."
              >
                <input className="input" value={form.cohosts} onChange={(e) => set("cohosts")(e.target.value)} placeholder="alice.near, bob.near" />
              </OptionRow>
            </div>
          </div>

          {error && <p className="text-sm text-warn break-words">{error}</p>}
          {accountId ? (
            <button className="btn btn-primary w-full !py-3 text-lg font-medium" disabled={busy}>
              {busy ? "Confirm in your wallet…" : "Create Event"}
            </button>
          ) : (
            <div className="lu-field p-4 space-y-2">
              <div className="text-sm font-medium">Sign in to create the event</div>
              <SignInOptions />
            </div>
          )}
          <p className="text-xs text-muted">
            After create you get your event page, plus an embed for your own site.{" "}
            <Link href="/widget" className="text-accent hover:underline">
              Want to integrate on your website?
            </Link>
          </p>
          <p className="text-xs text-muted">
            A little NEAR is attached for on-chain storage and comes back when the event closes.
          </p>
        </div>
        {themeOpen && <ThemeBar theme={theme} onChange={setTheme} onClose={() => setThemeOpen(false)} />}
      </form>
    </Themed>
  );
}

function Icon({ d, size = 16, className = "" }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Closes when you click outside it or press Escape. */
function Popover({ onClose, children, className = "" }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`absolute z-40 mt-1 rounded-xl border border-border bg-surface text-text shadow-xl ${className}`}>
      {children}
    </div>
  );
}

/** Start/End with a little timeline on the left and the time zone box on the right. */
function WhenBlock({ when, onChange }: { when: When; onChange: (w: When) => void }) {
  const s = fromEpoch(when.start, when.tz);
  const e = fromEpoch(when.end, when.tz);
  // Moving the start keeps the length of the event, like Luma.
  const setStart = (date: string, time: string) => {
    const start = toEpoch(date, time, when.tz);
    onChange({ ...when, start, end: start + (when.end - when.start) });
  };
  const setEnd = (date: string, time: string) => onChange({ ...when, end: toEpoch(date, time, when.tz) });
  // Changing the zone keeps the wall-clock times the host typed.
  const setTz = (tz: string) => onChange({ tz, start: toEpoch(s.date, s.time, tz), end: toEpoch(e.date, e.time, tz) });

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <div className="lu-field relative flex-1 py-1.5 pl-3 pr-1.5">
        <span aria-hidden className="absolute left-[17px] top-[26px] bottom-[26px] border-l border-dashed border-muted/50" />
        <DTRow label="Start" dot="fill" date={s.date} time={s.time} onChange={setStart} />
        <DTRow label="End" dot="ring" date={e.date} time={e.time} onChange={setEnd} invalid={when.end <= when.start} />
      </div>
      <TzBox tz={when.tz} at={when.start} onChange={setTz} />
    </div>
  );
}

function DTRow({ label, dot, date, time, onChange, invalid }: { label: string; dot: "fill" | "ring"; date: string; time: string; onChange: (d: string, t: string) => void; invalid?: boolean }) {
  const dateRef = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState(false);
  return (
    <div className="flex items-center gap-3 py-1">
      <span className={`relative z-10 w-2.5 h-2.5 rounded-full shrink-0 ${dot === "fill" ? "bg-muted" : "border border-muted bg-[var(--bg)]"}`} />
      <span className="flex-1 text-muted">{label}</span>
      <div className={`flex rounded-lg gap-px ${invalid ? "ring-1 ring-warn" : ""}`}>
        <label className="lu-pill rounded-l-lg relative cursor-pointer w-[124px]">
          {dayLabel(date)}
          <input
            ref={dateRef}
            type="date"
            aria-label={`${label} date`}
            value={date}
            onChange={(ev) => ev.target.value && onChange(ev.target.value, time)}
            onClick={() => dateRef.current?.showPicker?.()}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <div className="relative">
          <button type="button" aria-label={`${label} time`} className="lu-pill rounded-r-lg w-[72px] tabular-nums" onClick={() => setSlots(!slots)}>
            {time}
          </button>
          {slots && (
            <Popover onClose={() => setSlots(false)} className="right-0 w-28 max-h-64 overflow-y-auto p-1">
              <input
                type="time"
                aria-label={`${label} exact time`}
                defaultValue={time}
                onChange={(ev) => ev.target.value && onChange(date, ev.target.value)}
                className="w-full px-2 py-1 mb-1 rounded-md bg-transparent border border-border text-sm"
              />
              {SLOTS.map((t) => (
                <button
                  key={t}
                  type="button"
                  ref={(el) => {
                    if (el && t === time && el.parentElement) el.parentElement.scrollTop = el.offsetTop - 96;
                  }}
                  onClick={() => {
                    onChange(date, t);
                    setSlots(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 rounded-md text-sm tabular-nums hover:bg-border/60 ${t === time ? "bg-border/60 font-medium" : ""}`}
                >
                  {t}
                </button>
              ))}
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}

function TzBox({ tz, at, onChange }: { tz: string; at: number; onChange: (tz: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [LOCAL_TZ, "UTC"];
    }
  }, []);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return all.filter((z) => !n || z.toLowerCase().replace(/_/g, " ").includes(n) || gmtLabel(z, at).toLowerCase().includes(n)).slice(0, 60);
  }, [all, q, at]);
  return (
    <div className="relative sm:w-[140px]">
      <button type="button" onClick={() => setOpen(!open)} className="lu-field lu-hover w-full h-full p-3 text-left flex sm:flex-col sm:justify-between gap-2" aria-label="Time zone">
        <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" className="text-muted" />
        <span>
          <span className="block text-sm font-medium">{gmtLabel(tz, at)}</span>
          <span className="block text-xs text-muted truncate">{city(tz)}</span>
        </span>
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="right-0 w-72 p-1">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a time zone" className="w-full px-3 py-2 mb-1 bg-transparent outline-none border-b border-border text-sm" />
          <div className="max-h-64 overflow-y-auto">
            {list.map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => {
                  onChange(z);
                  setOpen(false);
                }}
                className={`flex w-full gap-3 px-3 py-1.5 rounded-md text-sm text-left hover:bg-border/60 ${z === tz ? "font-medium bg-border/60" : ""}`}
              >
                <span className="text-muted tabular-nums w-20 shrink-0">{gmtLabel(z, at)}</span>
                <span className="truncate">{z.replace(/_/g, " ")}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

/** A quiet row ("Add Event Location") that turns into a field when you click it. */
function ExpandRow({ icon, title, hint, value, multiline, children }: { icon: string; title: string; hint?: string; value: string; multiline?: boolean; children: (close: () => void) => ReactNode }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="lu-field flex gap-3 px-3 py-2.5 items-start">
        <Icon d={icon} className="text-muted mt-1" />
        <div className="flex-1 min-w-0">{children(() => setEditing(false))}</div>
      </div>
    );
  return (
    <button type="button" onClick={() => setEditing(true)} className="lu-field lu-hover w-full flex gap-3 px-3 py-2 text-left items-start">
      <Icon d={icon} className="text-muted mt-1" />
      <span className="flex-1 min-w-0">
        {value ? (
          <span className={`block ${multiline ? "whitespace-pre-line line-clamp-4" : "truncate"}`}>{value}</span>
        ) : (
          <>
            <span className="block text-muted">{title}</span>
            {hint && <span className="block text-xs text-muted/80">{hint}</span>}
          </>
        )}
      </span>
    </button>
  );
}

/** An option row with its value and a pencil; the editor opens in a small dialog. */
function OptionRow({ icon, label, value, title, help, children }: { icon: string; label: string; value: string; title: string; help: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lu-row lu-hover text-left" onClick={() => setOpen(true)}>
        <Icon d={icon} className="text-muted" />
        <span className="flex-1">{label}</span>
        <span className="text-muted">{value}</span>
        <Icon d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" size={14} className="text-muted" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-surface text-text border border-border shadow-2xl p-5 space-y-3" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), setOpen(false))}>
            <div className="text-lg font-semibold">{title}</div>
            <p className="text-sm text-muted">{help}</p>
            {children}
            <button type="button" className="btn btn-primary w-full" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Opens from the Theme button, like Luma: themes, then color, font, light/dark, effect and shuffle. */
function ThemeBar({ theme, onChange, onClose }: { theme: Theme; onChange: (t: Theme) => void; onClose: () => void }) {
  const [open, setOpen] = useState<"color" | "font" | null>(null);
  const pick = (name: ThemeName) => onChange({ ...defaultTheme(name), image: theme.image, emoji: theme.emoji });
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4 overflow-x-auto">
        <div className="flex gap-3 shrink-0" role="group" aria-label="Theme">
          {(Object.keys(THEMES) as ThemeName[]).map((name) => {
            const t = { ...defaultTheme(name), emoji: theme.emoji };
            const { background, vars } = themeStyle(t);
            const active = theme.name === name;
            return (
              <button key={name} type="button" onClick={() => pick(name)} className="flex flex-col items-center gap-1 shrink-0">
                <span
                  className={`block w-14 h-10 rounded-lg border overflow-hidden ${active ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "border-border"}`}
                  style={{ ...vars, background }}
                >
                  <span className="block w-6 h-4 m-1.5 rounded" style={{ background: themeCover(t) }} />
                </span>
                <span className={`text-[11px] ${active ? "font-semibold" : "text-muted"}`}>{THEMES[name].label}</span>
              </button>
            );
          })}
        </div>
        <div className="h-10 w-px bg-border shrink-0" />
        <div className="relative shrink-0">
          <button type="button" onClick={() => setOpen(open === "color" ? null : "color")} className="flex flex-col items-center gap-1">
            <span className="w-8 h-8 rounded-full border border-border" style={{ background: theme.color }} />
            <span className="text-[11px] text-muted">Color</span>
          </button>
          {open === "color" && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 card p-2 flex gap-1.5 shadow-xl">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => onChange({ ...theme, color: c })}
                  className={`w-7 h-7 rounded-full ${theme.color === c ? "ring-2 ring-offset-2 ring-offset-surface ring-text" : ""}`}
                  style={{ background: c }}
                />
              ))}
              <input type="color" aria-label="Custom color" value={theme.color} onChange={(e) => onChange({ ...theme, color: e.target.value })} className="w-7 h-7" />
            </div>
          )}
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setOpen(open === "font" ? null : "font")} className="flex flex-col items-center gap-1">
            <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center text-sm" style={{ fontFamily: FONTS[theme.font].css }}>
              Ag
            </span>
            <span className="text-[11px] text-muted">Font</span>
          </button>
          {open === "font" && (
            <div className="absolute bottom-14 left-1/2 -translate-x-1/2 card p-1 w-40 shadow-xl">
              {(Object.keys(FONTS) as FontKey[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    onChange({ ...theme, font: f });
                    setOpen(null);
                  }}
                  className={`block w-full text-left px-3 py-1.5 rounded-lg hover:bg-border/50 ${theme.font === f ? "font-semibold" : ""}`}
                  style={{ fontFamily: FONTS[f].css }}
                >
                  {FONTS[f].label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...theme, display: theme.display === "dark" ? "light" : "dark" })}
          className="flex flex-col items-center gap-1 shrink-0"
        >
          <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center">{theme.display === "dark" ? "☾" : "☀"}</span>
          <span className="text-[11px] text-muted">Display</span>
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...theme, effect: !theme.effect })}
          className="flex flex-col items-center gap-1 shrink-0"
          aria-pressed={theme.effect}
        >
          <span className={`w-8 h-8 rounded-full border flex items-center justify-center ${theme.effect ? "border-accent bg-accent-soft" : "border-border"}`}>✨</span>
          <span className="text-[11px] text-muted">Effect</span>
        </button>
        <button type="button" onClick={() => onChange(shuffleTheme(theme))} className="flex flex-col items-center gap-1 shrink-0">
          <span className="w-8 h-8 rounded-full border border-border flex items-center justify-center">🎲</span>
          <span className="text-[11px] text-muted">Shuffle</span>
        </button>
        {theme.name === "emoji" && (
          <label className="flex flex-col items-center gap-1 shrink-0">
            <input
              className="w-10 h-8 rounded-full border border-border bg-transparent text-center"
              value={theme.emoji}
              maxLength={4}
              onChange={(e) => onChange({ ...theme, emoji: [...e.target.value].slice(-1).join("") || "🎉" })}
              aria-label="Emoji"
            />
            <span className="text-[11px] text-muted">Emoji</span>
          </label>
        )}
        <button type="button" onClick={onClose} className="btn btn-primary !py-2 text-sm ml-auto shrink-0 sticky right-0 shadow-[-12px_0_12px_var(--surface)]">
          Done
        </button>
      </div>
    </div>
  );
}

/** After creating: share our page, or embed on the host’s own site. */
function Created({ event }: { event: EventView }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const page = `${origin}/e/${event.id}`;
  const widget = `${origin}/widget?event=${event.id}`;
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex gap-4 items-center">
        <Cover event={event} className="w-20 h-20 rounded-xl shrink-0 [&>span]:hidden" />
        <div>
          <div className="text-sm text-good font-medium">✓ Event created</div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.metadata.title}</h1>
          <p className="text-sm text-muted mt-1">Share the page, or put the widget on your own site.</p>
        </div>
      </div>

      <div className="space-y-3">
        <Way
          title="1 · Near Events page"
          text="Share this link. Registration, deposit and check-in all happen here."
          value={page}
        />
        <Way
          title="2 · Your own website"
          text="Two lines of code, or paste a prompt into Cursor / Claude and let it add the widget."
          value={widget}
          link
          linkLabel="Open integrate guide"
          extra={
            <Link href={widget} className="text-sm font-medium text-accent hover:underline">
              Want to integrate on your website? →
            </Link>
          }
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/e/${event.id}`} className="btn btn-primary">
          Open event page
        </Link>
        <Link href={`/e/${event.id}/manage`} className="btn btn-ghost">
          Check-in page
        </Link>
        <Link href={widget} className="btn btn-ghost">
          Integrate widget
        </Link>
      </div>
    </div>
  );
}

function Way({
  title,
  text,
  value,
  link,
  linkLabel,
  extra,
}: {
  title: string;
  text: string;
  value: string;
  link?: boolean;
  linkLabel?: string;
  extra?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-4 space-y-2">
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted">{text}</p>
      {extra}
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{value}</code>
        {link ? (
          <a href={value} className="btn btn-ghost !py-1.5 text-sm">
            {linkLabel ?? "Open"}
          </a>
        ) : (
          <button
            type="button"
            className="btn btn-ghost !py-1.5 text-sm"
            onClick={() =>
              navigator.clipboard.writeText(value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
