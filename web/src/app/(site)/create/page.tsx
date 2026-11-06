"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { events, toUnits, type EventMode, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Cover } from "@/components/ui";
import { EventThemePicker } from "@/components/EventThemePicker";
import { createRandomEventVisual, createRandomVisual, type EventVisualConfig } from "@/lib/event-visuals";
import { rememberEventVisual } from "@/lib/event-visual-client";
import { SignInOptions } from "@/components/SignIn";
import { LOCAL_TZ, city, dayLabel, fromEpoch, gmtLabel, toEpoch } from "@/lib/time";
import type { EventDetails, ImportedEvent } from "@/lib/eventImport";


const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

interface When {
  start: number;
  end: number;
  tz: string;
}

/** Create an event with its public details and escrow options. */
export default function CreateEvent() {
  const { accountId, send, staffToken } = useWallet();
  const [form, setForm] = useState({ title: "", location: "", description: "", cover_url: "", deposit: "10", capacity: "50", cohosts: "", mode: "Deposit" as EventMode });
  const [when, setWhen] = useState<When | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EventView | null>(null);
  const [createdDetails, setCreatedDetails] = useState<EventDetails | null>(null);
  const [eventVisual, setEventVisual] = useState<EventVisualConfig>({ themeId: "near", seed: 0 });
  const [createdVisual, setCreatedVisual] = useState<EventVisualConfig | null>(null);
  const [detailsSaveError, setDetailsSaveError] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [visualSaveError, setVisualSaveError] = useState<string | null>(null);
  const [savingVisual, setSavingVisual] = useState(false);
  // Like Luma, the form is open to everyone; signing in is asked for on "Create Event".
  const [askSignIn, setAskSignIn] = useState(false);
  useEffect(() => {
    if (accountId) setAskSignIn(false);
  }, [accountId]);

  // "Duplicate event" (Luma, Hi.Events): /create?from=<id> copies everything but the date.
  useEffect(() => {
    const from = Number(new URLSearchParams(window.location.search).get("from"));
    if (!Number.isInteger(from) || !window.location.search.includes("from=")) return;
    events.get(from).then((e) => {
      if (!e) return;
      setForm((f) => ({
        ...f,
        title: e.metadata.title,
        location: e.metadata.location,
        description: e.metadata.description,
        deposit: String(Number(e.deposit) / 1e6),
        mode: e.mode ?? "Deposit",
        capacity: String(e.capacity),
        cohosts: e.cohosts.join(", "),
      }));
      fetch(`/api/event-details?e=${encodeURIComponent(String(from))}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((json) => {
          const details = json?.details as EventDetails | null | undefined;
          if (details) setForm((f) => ({ ...f, ...details, cover_url: details.cover_url ?? "" }));
        })
        .catch(() => {});
      fetch(`/api/event-visuals?ids=${encodeURIComponent(String(from))}`, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((json) => {
          const visual = json?.visuals?.[String(from)] as EventVisualConfig | undefined;
          if (visual) setEventVisual(visual);
        })
        .catch(() => {});
    });
  }, []);

  // Start with a varied preview; a duplicated event can replace this with its saved look.
  useEffect(() => setEventVisual(createRandomEventVisual()), []);

  // Default to tomorrow, on the hour, for two hours (set on the client, not during prerender).
  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setMinutes(0, 0, 0);
    setWhen((w) => w ?? { start: start.getTime(), end: start.getTime() + 2 * 3600_000, tz: LOCAL_TZ });
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const importEvent = async () => {
    setImporting(true);
    setError(null);
    try {
      const isBaliSquad = (() => {
        try {
          const value = importUrl.trim();
          const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
          return ["balisquad.com", "www.balisquad.com"].includes(url.hostname);
        } catch {
          return false;
        }
      })();
      const source = isBaliSquad ? "BaliSquad" : "Luma";
      const endpoint = isBaliSquad ? "/api/balisquad/import" : "/api/luma/import";
      const r = await fetch(`${endpoint}?url=${encodeURIComponent(importUrl)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      const event = j as ImportedEvent;
      setForm((f) => ({ ...f, title: event.title, location: event.location, description: event.description, cover_url: event.cover_url ?? "" }));
      if (isBaliSquad) setEventVisual(createRandomVisual("paradise"));
      setWhen((w) => ({ tz: w?.tz ?? LOCAL_TZ, start: event.starts_at, end: event.ends_at }));
      setImported(source);
      setImportOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when) return;
    if (!accountId) return setAskSignIn(true);
    if (when.end <= when.start) return setError("The event has to end after it starts.");
    setBusy(true);
    setError(null);
    let transactionSent = false;
    try {
      const capacity = Number(form.capacity);
      const title = form.title.trim();
      const encoder = new TextEncoder();
      if (encoder.encode(title).length > 120) {
        throw new Error("Title is too long. Shorten it and try again.");
      }
      const location = form.location.trim();
      const description = form.description.trim();
      const rawCoverUrl = form.cover_url.trim();
      const coverUrl = rawCoverUrl ? safeImageUrl(rawCoverUrl) : null;
      if (rawCoverUrl && !coverUrl) throw new Error("Use a public HTTP or HTTPS image link for the cover image.");
      if (encoder.encode(location).length > 1000) throw new Error("Location is too long. Shorten it and try again.");
      if (encoder.encode(description).length > 10_000) throw new Error("Event details are too long. Shorten them and try again.");
      const submittedAt = Date.now();
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              description: "",
              location: "",
              cover_url: null,
              starts_at: when.start,
              ends_at: when.end,
            },
            deposit: toUnits(form.deposit),
            capacity,
            cohosts: form.cohosts.split(/[\s,]+/).filter(Boolean),
            mode: form.mode,
          },
        },
      ]);
      transactionSent = true;
      const matches = (ev: EventView) => ev.host === accountId
        && ev.metadata.title === title
        && ev.metadata.starts_at === when.start
        && ev.metadata.ends_at === when.end
        && ev.created_at >= submittedAt - 60_000;
      let latest: EventView | undefined;
      for (let attempt = 0; attempt < 4 && !latest; attempt++) {
        latest = (await events.list().catch(() => [])).find(matches);
        if (!latest && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!latest) {
        setError("The event may already be created, but its page could not be loaded. Refresh before trying again.");
        return;
      }
      setCreated(latest);
      setCreatedVisual(eventVisual);
      const details: EventDetails = { location, description, cover_url: coverUrl };
      const hasDetails = Boolean(location || description || coverUrl);
      if (hasDetails) setCreatedDetails(details);
      let token: string | null = null;
      try {
        token = await staffToken();
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : "Could not authorize off-chain event settings";
        setVisualSaveError(message);
        if (hasDetails) setDetailsSaveError(message);
      }

      setSavingVisual(true);
      if (token) {
        try {
          await saveVisual(latest.id, eventVisual, token);
          rememberEventVisual(latest.id, eventVisual);
          setVisualSaveError(null);
        } catch (saveError) {
          setVisualSaveError(saveError instanceof Error ? saveError.message : "Could not save event visual");
        } finally {
          setSavingVisual(false);
        }
      } else {
        setSavingVisual(false);
      }

      if (hasDetails && token) {
        setCreatedDetails(details);
        setSavingDetails(true);
        try {
          await saveDetails(latest.id, details, token);
          setDetailsSaveError(null);
        } catch (saveError) {
          setDetailsSaveError(saveError instanceof Error ? saveError.message : "Could not save event details");
        } finally {
          setSavingDetails(false);
        }
      }
    } catch (err) {
      setError(transactionSent
        ? "The event may already be created. Refresh before trying again to avoid creating a duplicate."
        : err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const retryDetailsSave = async () => {
    if (!created || !createdDetails) return;
    setSavingDetails(true);
    try {
      const token = await staffToken();
      await saveDetails(created.id, createdDetails, token);
      setDetailsSaveError(null);
    } catch (saveError) {
      setDetailsSaveError(saveError instanceof Error ? saveError.message : "Could not save event details");
    } finally {
      setSavingDetails(false);
    }
  };

  const retryVisualSave = async () => {
    if (!created || !createdVisual) return;
    setSavingVisual(true);
    try {
      const token = await staffToken();
      await saveVisual(created.id, createdVisual, token);
      rememberEventVisual(created.id, createdVisual);
      setVisualSaveError(null);
    } catch (saveError) {
      setVisualSaveError(saveError instanceof Error ? saveError.message : "Could not save event visual");
    } finally {
      setSavingVisual(false);
    }
  };

  if (created) return <Created event={created} visual={createdVisual} coverUrl={createdDetails?.cover_url} detailsSaveError={detailsSaveError} savingDetails={savingDetails} onRetry={retryDetailsSave} visualSaveError={visualSaveError} savingVisual={savingVisual} onRetryVisual={retryVisualSave} />;

  return (
    <>
      <form onSubmit={submit} className="max-w-2xl mx-auto space-y-4 pb-40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="lu-chip">
              {accountId ? <span className="truncate max-w-44">{accountId}</span> : "Your events"}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" className="lu-chip lu-hover" onClick={() => setImportOpen(!importOpen)}>
                {imported ? `✓ Imported from ${imported}` : "Import event"}
              </button>
              <span className="lu-chip" title="Every event is public in v1">
                <Icon d="M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" size={14} />
                Public
              </span>
            </div>
          </div>
          {importOpen && (
            <div className="lu-field p-2 flex gap-2">
              <input
                autoFocus
                className="flex-1 min-w-0 bg-transparent px-2 outline-none text-sm"
                placeholder="Paste a Luma or BaliSquad event link"
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
              <button type="button" className="btn btn-primary !py-1.5 text-sm" disabled={!importUrl.trim() || importing} onClick={importEvent}>
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

          <EventThemePicker value={eventVisual} title={form.title} coverUrl={safeImageUrl(form.cover_url)} onChange={setEventVisual} />

          {when && <WhenBlock when={when} onChange={setWhen} />}

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="label">Location (optional)</span>
              <textarea
                rows={3}
                className="lu-field w-full px-3 py-2 text-sm resize-y"
                value={form.location}
                onChange={(e) => set("location")(e.target.value)}
                placeholder="Venue or address"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Event details (optional)</span>
              <textarea
                className="lu-field w-full px-3 py-2 text-sm min-h-28 resize-y"
                maxLength={10_000}
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder="Description, host contacts, and useful links"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Custom cover image (optional)</span>
              <input
                className="lu-field w-full px-3 py-2 text-sm"
                type="url"
                value={form.cover_url}
                onChange={(e) => set("cover_url")(e.target.value)}
                placeholder="Public image link"
              />
              {safeImageUrl(form.cover_url) && <img src={safeImageUrl(form.cover_url)!} alt="Custom cover image preview" referrerPolicy="no-referrer" className="w-full max-h-56 rounded-xl object-cover" />}
            </label>
            <p className="text-xs text-muted">The title cover and theme background stay separate. Paradise uses a Bali photo for the page background. Visual settings, location, details, and cover image are stored off-chain.</p>
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium text-muted">Event Options</div>
            <div className="rounded-xl overflow-hidden flex flex-col lu-rows">
              {/* One or the other, never both: a deposit pool or a paid ticket. */}
              <div className="lu-row">
                <Icon d="M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2M4 12a8 8 0 1016 0 8 8 0 00-16 0z" className="text-muted" />
                <span className="flex-1">Guests pay</span>
                <div className="flex gap-1 rounded-full p-0.5" style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }} role="radiogroup" aria-label="Guests pay">
                  {(["Deposit", "Ticket"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={form.mode === m}
                      onClick={() => setForm((f) => ({ ...f, mode: m }))}
                      className={`px-3 py-1 rounded-full text-sm ${form.mode === m ? "bg-accent text-white" : "text-muted"}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <OptionRow
                icon="M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4zM14 6v12"
                label={form.mode === "Ticket" ? "Ticket price" : "Deposit"}
                value={`${form.deposit} USDC`}
                title={form.mode === "Ticket" ? "Ticket price" : "Deposit"}
                help={
                  form.mode === "Ticket"
                    ? "Each guest pays this for a ticket. You get it after the event starts and you close it. If you cancel, every guest gets it back."
                    : "Each guest puts this down. People who come get it back plus a share of the no-shows."
                }
              >
                <input className="input" type="number" min="0.1" step="0.01" required value={form.deposit} onChange={(e) => set("deposit")(e.target.value)} />
              </OptionRow>
              <div className="lu-row">
                <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" className="text-muted" />
                {form.mode === "Ticket" ? (
                  <>
                    <span className="flex-1">You get paid after the event</span>
                    <span className="text-muted text-sm">Refunds if cancelled</span>
                  </>
                ) : (
                  <>
                    <span className="flex-1">Show-ups split no-shows</span>
                    <span className="text-muted text-sm">Always on</span>
                  </>
                )}
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
          <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy}>
            {busy ? "Confirm in your wallet…" : "Create Event"}
          </button>
          <p className="text-xs text-muted/80">
            One event gives you a full Near Me page, a quick checkout link, and a button code for your site. Manage guests and check-in in the event admin.
          </p>
      </form>
      {askSignIn && <SignInDialog onClose={() => setAskSignIn(false)} />}
    </>
  );
}

/** Shown when a guest presses "Create Event": the form stays filled in behind it. */
function SignInDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Sign in" className="w-full max-w-[360px] rounded-2xl bg-surface text-text border border-border shadow-2xl p-5 space-y-4">
        <div className="space-y-1">
          <div className="w-11 h-11 !rounded-full lu-field flex items-center justify-center mb-3">
            <Icon d="M10 17l5-5-5-5M15 12H3M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5" size={18} />
          </div>
          <div className="text-lg font-semibold">Sign in to create</div>
          <p className="text-sm text-muted">Your event stays filled in. A NEAR wallet or Google/email both work.</p>
        </div>
        <SignInOptions />
        <p className="text-[11px] text-muted/80">A little NEAR is held for on-chain storage and comes back when the event closes.</p>
      </div>
    </div>
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

function OptionRow({ icon, label, value, title, help, children }: { icon: string; label: string; value: string; title: string; help: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lu-row lu-hover text-left" onClick={() => setOpen(true)}>
        <Icon d={icon} className="text-muted" />
        <span className="flex-1">{label}</span>
        <span className="text-muted font-medium">{value}</span>
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

/** After creating: share the event page, quick checkout, or simple site button. */
function Created({ event, visual, coverUrl, detailsSaveError, savingDetails, onRetry, visualSaveError, savingVisual, onRetryVisual }: {
  event: EventView;
  visual: EventVisualConfig | null;
  coverUrl?: string | null;
  detailsSaveError: string | null;
  savingDetails: boolean;
  onRetry: () => void;
  visualSaveError: string | null;
  savingVisual: boolean;
  onRetryVisual: () => void;
}) {
  const [origin, setOrigin] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);
  const page = `${origin}/e/${event.id}`;
  const checkout = `${origin}/p/${event.id}`;
  const buttonCode = `<script src="${origin}/embed.js" async></script>\n<near-event event="${event.id}" mode="button"></near-event>`;
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex gap-4 items-center">
        <Cover event={event} visual={visual ?? undefined} coverUrl={coverUrl} className="w-20 h-20 rounded-xl shrink-0 [&>span]:hidden" />
        <div>
          <div className="text-sm text-good font-medium">✓ Event created</div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.metadata.title}</h1>
          <p className="text-sm text-muted mt-1">Your event page, quick checkout, and host controls are ready.</p>
        </div>
      </div>

      {detailsSaveError && (
        <div className="card p-4 space-y-2 border-warn/50">
          <p className="text-sm text-warn">The event was created, but its public details could not be saved: {detailsSaveError}</p>
          <button type="button" className="btn btn-ghost !py-1.5 text-sm" disabled={savingDetails} onClick={onRetry}>
            {savingDetails ? "Saving…" : "Retry saving details"}
          </button>
        </div>
      )}
      {savingDetails && <p className="text-sm text-muted">Saving public event details…</p>}
      {visualSaveError && (
        <div className="card p-4 space-y-2 border-warn/50">
          <p className="text-sm text-warn">The event was created, but its theme could not be saved: {visualSaveError}</p>
          <button type="button" className="btn btn-ghost !py-1.5 text-sm" disabled={savingVisual} onClick={onRetryVisual}>
            {savingVisual ? "Saving…" : "Retry saving theme"}
          </button>
        </div>
      )}
      {savingVisual && <p className="text-sm text-muted">Saving the event look off-chain…</p>}

      <div className="space-y-3">
        <Way
          title="Event page on Near Me"
          text="Share this link. Registration, payment and check-in all happen here."
          value={page}
        />
        <Way
          title="Quick checkout link"
          text="Use this in a message, or put it behind any button on your site."
          value={checkout}
        />
        <div className="card p-4 space-y-3">
          <div>
            <div className="font-medium">Checkout button for your site</div>
            <p className="text-sm text-muted mt-1">This opens the quick checkout. Guests can return to the same button for their QR pass or payout.</p>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-bg p-3 text-xs">{buttonCode}</pre>
          <button
            type="button"
            className="btn btn-ghost !py-1.5 text-sm self-start"
            disabled={!origin}
            onClick={() => navigator.clipboard.writeText(buttonCode).then(() => {
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 1500);
            })}
          >
            {copiedCode ? "Copied" : "Copy button code"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link href={`/e/${event.id}`} className="btn btn-primary">
          Open event page
        </Link>
        <Link href={`/e/${event.id}/manage`} className="btn btn-ghost">
          Manage guests &amp; check-in
        </Link>
      </div>
    </div>
  );
}

function safeImageUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

async function saveDetails(eventId: number, details: EventDetails, token: string) {
  const response = await fetch("/api/event-details", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, details }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save event details");
}

async function saveVisual(eventId: number, visual: EventVisualConfig, token: string) {
  const response = await fetch("/api/event-visuals", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ eventId, visual }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save event visual");
}

function Way({
  title,
  text,
  value,
}: {
  title: string;
  text: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-4 space-y-2">
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted">{text}</p>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{value}</code>
        <button
          type="button"
          className="btn btn-ghost !py-1.5 text-sm"
          disabled={!value}
          onClick={() =>
            navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
