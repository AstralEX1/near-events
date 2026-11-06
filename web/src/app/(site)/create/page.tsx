"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { events, toUnits, type EventMode, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { EventSetup } from "@/components/EventSetup";
import { SignInOptions } from "@/components/SignIn";
import { LOCAL_TZ, city, dayLabel, fromEpoch, gmtLabel, toEpoch } from "@/lib/time";
import { detectEventSource, fitImportedEvent, IMPORT_ENDPOINT, locationProblem, type ImportedEvent } from "@/lib/eventImport";


const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

interface When {
  start: number;
  end: number;
  tz: string;
}

const DEPOSIT_HELP = "Each guest puts this down. People who come get it back plus a share of the no-shows.";
const TICKET_HELP = "Each guest pays this for a ticket. You get it after the event starts and you close it. If you cancel, every guest gets it back.";

export default function CreatePage() {
  return (
    <Suspense fallback={<p className="max-w-2xl mx-auto text-sm text-muted">Loading…</p>}>
      <CreateEvent />
    </Suspense>
  );
}

/**
 * Create an event with its public details and escrow options.
 * /create?flow=widget&import=<link> is the Integrate flow: the event is imported on load,
 * and the host has to choose how guests pay, the amount and the capacity themselves.
 */
function CreateEvent() {
  const { accountId, send } = useWallet();
  const params = useSearchParams();
  const integrate = params.get("flow") === "widget";
  const importOnLoad = params.get("import");
  const [form, setForm] = useState({
    title: "",
    location: "",
    description: "",
    deposit: integrate ? "" : "10",
    capacity: integrate ? "" : "50",
    cohosts: "",
    mode: (integrate ? null : "Deposit") as EventMode | null,
  });
  const [when, setWhen] = useState<When | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState(importOnLoad ?? "");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [loadingImport, setLoadingImport] = useState(Boolean(importOnLoad));
  const [imported, setImported] = useState<string | null>(null);
  const [shortened, setShortened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EventView | null>(null);
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
    });
  }, []);

  // Default to tomorrow, on the hour, for two hours (set on the client, not during prerender).
  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setMinutes(0, 0, 0);
    setWhen((w) => w ?? { start: start.getTime(), end: start.getTime() + 2 * 3600_000, tz: LOCAL_TZ });
  }, []);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const amountLabel = form.mode === "Ticket" ? "Ticket price" : form.mode === "Deposit" ? "Deposit" : "Amount";

  const importEvent = async (link: string) => {
    setImporting(true);
    setImportError(null);
    try {
      // An unknown link goes to Luma too: its importer explains what a good link looks like.
      const source = detectEventSource(link) ?? "Luma";
      const r = await fetch(`${IMPORT_ENDPOINT[source]}?url=${encodeURIComponent(link)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      const { event, shortened } = fitImportedEvent(j as ImportedEvent);
      setShortened(shortened);
      setForm((f) => ({ ...f, title: event.title, location: event.location, description: event.description }));
      setWhen((w) => ({ tz: w?.tz ?? LOCAL_TZ, start: event.starts_at, end: event.ends_at }));
      setImported(source);
      setImportOpen(false);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImportOpen(true);
    } finally {
      setImporting(false);
    }
  };

  // Integrate flow: the link was given on the previous screen, so don't ask for it again.
  const importStarted = useRef(false);
  useEffect(() => {
    if (!importOnLoad || importStarted.current) return;
    importStarted.current = true;
    importEvent(importOnLoad).finally(() => setLoadingImport(false));
  }, [importOnLoad]);

  const amount = Number(form.deposit);
  const seats = Number(form.capacity);
  const amountOk = amount >= 0.1;
  const seatsOk = Number.isInteger(seats) && seats >= 1 && seats <= 300;
  const missing = !form.mode ? "Choose Deposit or Ticket" : !amountOk ? "Set the amount: at least 0.1 USDC" : !seatsOk ? "Set the capacity: 1 to 300" : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!when || missing || !form.mode) return;
    const badLocation = locationProblem(form.location);
    if (badLocation) return setError(badLocation);
    if (!accountId) return setAskSignIn(true);
    if (when.end <= when.start) return setError("The event has to end after it starts.");
    setBusy(true);
    setError(null);
    try {
      const capacity = Number(form.capacity);
      const title = form.title.trim();
      const encoder = new TextEncoder();
      if (encoder.encode(title).length > 120) {
        throw new Error("Title is too long. Shorten it and try again.");
      }
      const location = form.location.trim();
      const description = form.description.trim();
      if (encoder.encode(description).length > 2000) throw new Error("Event details are too long. Shorten them and try again.");
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              description,
              location,
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
      // The new event is the latest one this account created with this title.
      const latest = (await events.list()).find((ev) => ev.host === accountId && ev.metadata.title === title);
      if (latest) setCreated(latest);
      else setError("Your event was created, but we couldn’t load it yet. Find it on your profile page.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (created) return <EventSetup event={created} integrate={integrate} />;
  if (loadingImport) {
    return (
      <p className="max-w-2xl mx-auto text-sm text-muted" role="status">
        Importing…
      </p>
    );
  }

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
              <button type="button" className="btn btn-primary !py-1.5 text-sm" disabled={!importUrl.trim() || importing} onClick={() => importEvent(importUrl)}>
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          )}
          {importError && <p className="text-sm text-warn break-words">{importError}</p>}

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

          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="label">Location (optional)</span>
              <input
                className="lu-field w-full px-3 py-2 text-sm"
                inputMode="url"
                autoComplete="off"
                value={form.location}
                onChange={(e) => {
                  setError(null);
                  set("location")(e.target.value);
                }}
                placeholder="Google Maps link"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="label">Event details (optional)</span>
              <textarea
                className="lu-field w-full px-3 py-2 text-sm min-h-28 resize-y"
                value={form.description}
                onChange={(e) => set("description")(e.target.value)}
                placeholder="Description, host contacts, and useful links"
              />
            </label>
            {shortened && <p className="text-xs text-warn">Details shortened to fit.</p>}
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-sm font-medium text-muted">Event Options</div>
            <div className="rounded-xl overflow-hidden flex flex-col lu-rows">
              {/* One or the other, never both: a deposit pool or a paid ticket. */}
              <div className="lu-row">
                <Icon d="M12 8c-2.2 0-4 .9-4 2s1.8 2 4 2 4 .9 4 2-1.8 2-4 2m0-8V6m0 10v2M4 12a8 8 0 1016 0 8 8 0 00-16 0z" className="text-muted" />
                <span className="flex-1">Guests pay</span>
                <div className={`flex gap-1 rounded-full p-0.5 ${form.mode ? "" : "ring-1 ring-accent"}`} style={{ background: "color-mix(in srgb, var(--text) 8%, transparent)" }} role="radiogroup" aria-label="Guests pay">
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
                label={amountLabel}
                value={form.deposit ? `${form.deposit} USDC` : "Set"}
                title={amountLabel}
                help={form.mode === "Ticket" ? TICKET_HELP : form.mode === "Deposit" ? DEPOSIT_HELP : "USDC per guest."}
                attention={!amountOk}
              >
                <input className="input" type="number" min="0.1" step="0.01" required value={form.deposit} onChange={(e) => set("deposit")(e.target.value)} />
              </OptionRow>
              {form.mode && (
                <div className="lu-row">
                  <Icon d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" className="text-muted" />
                  <span className="flex-1">{form.mode === "Ticket" ? "You get paid after the event" : "Show-ups split no-shows"}</span>
                  <span className="text-muted text-sm">{form.mode === "Ticket" ? "Refunds if cancelled" : "Always on"}</span>
                </div>
              )}
              <OptionRow
                icon="M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3 3 0 100-6 3 3 0 000 6zM21 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8"
                label="Capacity"
                value={form.capacity || "Set"}
                title="Max capacity"
                help="Up to 300 guests. Registration closes when it's full."
                attention={!seatsOk}
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
          <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy || !!missing} title={missing ?? undefined}>
            {busy ? "Confirm in your wallet…" : "Create Event"}
          </button>
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

function OptionRow({ icon, label, value, title, help, attention, children }: { icon: string; label: string; value: string; title: string; help: string; attention?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lu-row lu-hover text-left" onClick={() => setOpen(true)}>
        <Icon d={icon} className="text-muted" />
        <span className="flex-1">{label}</span>
        <span className={`font-medium ${attention ? "text-accent" : "text-muted"}`}>{value}</span>
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
