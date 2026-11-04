"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, toUnits, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Cover } from "@/components/ui";
import { Themed } from "@/components/Themed";
import { COLORS, FONTS, THEMES, decodeTheme, defaultTheme, encodeTheme, shuffleTheme, themeCover, themeStyle, type FontKey, type Theme, type ThemeName } from "@/lib/theme";
import { SignInOptions } from "@/components/SignIn";

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

/**
 * Create an event the way Luma does: one card, cover on the left, the name
 * typed big, then time, place, description and options. A Luma link fills it
 * all in, so a host can move registration here in one paste.
 */
export default function CreateEvent() {
  const { accountId, send } = useWallet();
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    starts_at: "",
    ends_at: "",
    deposit: "10",
    capacity: "50",
    cohosts: "",
  });
  const [theme, setTheme] = useState<Theme>(defaultTheme("ambient"));
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
    const end = new Date(start.getTime() + 2 * 3600_000);
    setForm((f) => ({ ...f, starts_at: f.starts_at || localInput(start), ends_at: f.ends_at || localInput(end) }));
  }, []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const importLuma = async () => {
    setImporting(true);
    setError(null);
    try {
      const r = await fetch(`/api/luma/import?url=${encodeURIComponent(lumaUrl)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Import failed");
      setForm((f) => ({
        ...f,
        title: j.title,
        description: j.description,
        location: j.location,
        starts_at: localInput(new Date(j.starts_at)),
        ends_at: localInput(new Date(j.ends_at)),
      }));
      if (j.cover_url) setTheme((t) => ({ ...t, image: j.cover_url }));
      setImported(j.luma_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
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
              starts_at: new Date(form.starts_at).getTime(),
              ends_at: new Date(form.ends_at).getTime(),
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

  if (created) return <Created event={created} lumaUrl={imported} />;

  const preview = { id: 0, metadata: { title: form.title || "Event", cover_url: encodeTheme(theme) } } as EventView;

  return (
    <Themed theme={theme}>
    <form onSubmit={submit} className="max-w-4xl mx-auto grid gap-8 md:grid-cols-[300px_1fr] items-start pb-40">
      <div className="space-y-3">
        <div className="relative">
          <Cover event={preview} className="aspect-square w-full rounded-2xl [&>span]:hidden" />
          <button
            type="button"
            onClick={() => setPicker(!picker)}
            className="absolute bottom-3 right-3 h-9 px-3 rounded-full bg-black/60 text-white text-sm backdrop-blur"
          >
            {theme.image ? "Change image" : "Add image"}
          </button>
        </div>
        {picker && (
          <div className="card p-3 space-y-2">
            <input
              className="input text-sm"
              type="url"
              maxLength={200}
              placeholder="Paste an image link (https://…)"
              value={theme.image ?? ""}
              onChange={(e) => setTheme((t) => ({ ...t, image: e.target.value.trim() || null }))}
            />
            <p className="text-xs text-muted">Leave empty to use the theme’s own cover.</p>
          </div>
        )}
      </div>

      <div className="space-y-5 min-w-0">
        <div className="card p-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted px-1">Already on Luma?</span>
          <input
            className="input !py-2 text-sm flex-1 min-w-48"
            placeholder="Paste your Luma link to import it"
            value={lumaUrl}
            onChange={(e) => setLumaUrl(e.target.value)}
          />
          <button type="button" className="btn btn-ghost !py-2 text-sm" disabled={!lumaUrl.trim() || importing} onClick={importLuma}>
            {importing ? "Importing…" : "Import"}
          </button>
          {imported && <p className="w-full text-xs text-good px-1">✓ Imported. Check the details, then set the deposit.</p>}
        </div>

        <textarea
          required
          maxLength={120}
          rows={1}
          value={form.title}
          onChange={set("title")}
          placeholder="Event Name"
          aria-label="Event name"
          className="w-full resize-none bg-transparent text-4xl font-semibold tracking-tight outline-none placeholder:text-muted/50 [field-sizing:content]"
        />

        <div className="card divide-y divide-border">
          <Row label="Start">
            <input className="bg-transparent outline-none" type="datetime-local" required value={form.starts_at} onChange={set("starts_at")} />
          </Row>
          <Row label="End">
            <input className="bg-transparent outline-none" type="datetime-local" required value={form.ends_at} onChange={set("ends_at")} />
          </Row>
          <div className="px-4 py-2 text-xs text-muted">{TZ}</div>
        </div>

        <div className="card">
          <input
            className="w-full bg-transparent px-4 py-3.5 outline-none"
            maxLength={300}
            value={form.location}
            onChange={set("location")}
            placeholder="📍  Add event location (address or link)"
          />
        </div>

        <div className="card">
          <textarea
            className="w-full bg-transparent px-4 py-3.5 outline-none min-h-24"
            maxLength={2000}
            value={form.description}
            onChange={set("description")}
            placeholder="Add description"
          />
        </div>

        <div>
          <div className="label mb-2">Event options</div>
          <div className="card divide-y divide-border">
            <Row label="Deposit" hint="Back to everyone who comes, plus a share of the no-shows">
              <span className="flex items-center gap-1">
                <input
                  className="w-20 bg-transparent text-right outline-none font-medium"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={form.deposit}
                  onChange={set("deposit")}
                />
                <span className="text-muted">USDC</span>
              </span>
            </Row>
            <Row label="Capacity">
              <input
                className="w-20 bg-transparent text-right outline-none font-medium"
                type="number"
                min="1"
                max="300"
                required
                value={form.capacity}
                onChange={set("capacity")}
              />
            </Row>
            <Row label="Door team" hint="NEAR accounts that can check guests in">
              <input
                className="w-48 bg-transparent text-right outline-none"
                value={form.cohosts}
                onChange={set("cohosts")}
                placeholder="alice.near, bob.near"
              />
            </Row>
          </div>
        </div>

        {error && <p className="text-sm text-warn break-words">{error}</p>}
        {accountId ? (
          <button className="btn btn-primary w-full !py-3.5" disabled={busy}>{busy ? "Confirm in your wallet…" : "Create Event"}</button>
        ) : (
          <div className="card p-4 space-y-2">
            <div className="text-sm font-medium">Sign in to create the event</div>
            <SignInOptions />
          </div>
        )}
        <p className="text-xs text-muted">
          A little NEAR is attached for on-chain storage and comes back when the event closes. Hosting as a DAO? Create the
          event through a DAO proposal (see the guide).
        </p>
      </div>
      <ThemeBar theme={theme} onChange={setTheme} />
    </form>
    </Themed>
  );
}

/** Luma-style theme bar pinned to the bottom: themes, then color, font and light/dark. */
function ThemeBar({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const [open, setOpen] = useState<"color" | "font" | null>(null);
  const pick = (name: ThemeName) => onChange({ ...defaultTheme(name), image: theme.image, emoji: theme.emoji });
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/90 backdrop-blur">
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
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** After creating: the three ways to take registrations. */
function Created({ event, lumaUrl }: { event: EventView; lumaUrl: string | null }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const page = `${origin}/e/${event.id}`;
  const pay = `${origin}/p/${event.id}`;
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex gap-4 items-center">
        <Cover event={event} className="w-20 h-20 rounded-xl shrink-0 [&>span]:hidden" />
        <div>
          <div className="text-sm text-good font-medium">✓ Event created</div>
          <h1 className="text-2xl font-semibold tracking-tight">{event.metadata.title}</h1>
        </div>
      </div>
      <div className="space-y-3">
        <Way title="Your event page" text="Share it anywhere. Registration, deposit and check-in all happen here." value={page} />
        {lumaUrl && (
          <Way
            title="On your Luma event"
            text="Replace Luma's register button: put this link at the top of the Luma description and turn on Require Approval, so all sign-ups come here."
            value={pay}
          />
        )}
        <Way title="On your website" text="Add the button with two lines of code, or let your AI agent do it." value={`${origin}/widget?event=${event.id}`} link />
      </div>
      <div className="flex gap-3">
        <Link href={`/e/${event.id}`} className="btn btn-primary">Open event page</Link>
        <Link href={`/e/${event.id}/manage`} className="btn btn-ghost">Check-in page</Link>
      </div>
    </div>
  );
}

function Way({ title, text, value, link }: { title: string; text: string; value: string; link?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card p-4 space-y-2">
      <div className="font-medium">{title}</div>
      <p className="text-sm text-muted">{text}</p>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{value}</code>
        {link ? (
          <a href={value} className="btn btn-ghost !py-1.5 text-sm">Open</a>
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
