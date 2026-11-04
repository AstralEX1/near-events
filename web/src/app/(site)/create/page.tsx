"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, toUnits, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { COVER_PRESETS, Cover } from "@/components/ui";
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
    cover: "preset:violet",
    starts_at: "",
    ends_at: "",
    deposit: "10",
    capacity: "50",
    cohosts: "",
  });
  const [lumaUrl, setLumaUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<EventView | null>(null);

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
        cover: j.cover_url ?? f.cover,
        starts_at: localInput(new Date(j.starts_at)),
        ends_at: localInput(new Date(j.ends_at)),
      }));
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
              cover_url: form.cover.trim() || null,
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

  const preview = { id: 0, metadata: { title: form.title || "Event", cover_url: form.cover || null } } as EventView;

  return (
    <form onSubmit={submit} className="max-w-4xl mx-auto grid gap-8 md:grid-cols-[300px_1fr] items-start">
      <div className="space-y-3">
        <div className="relative">
          <Cover event={preview} className="aspect-square w-full rounded-2xl [&>span]:hidden" />
          <button
            type="button"
            onClick={() => setPicker(!picker)}
            className="absolute bottom-3 right-3 h-9 px-3 rounded-full bg-black/60 text-white text-sm backdrop-blur"
          >
            Change cover
          </button>
        </div>
        {picker && (
          <div className="card p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(COVER_PRESETS).map(([name, bg]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={`Cover ${name}`}
                  onClick={() => setForm((f) => ({ ...f, cover: `preset:${name}` }))}
                  className={`aspect-square rounded-xl ${form.cover === `preset:${name}` ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : ""}`}
                  style={{ background: bg }}
                />
              ))}
            </div>
            <input
              className="input text-sm"
              type="url"
              maxLength={300}
              placeholder="Or paste an image link"
              value={form.cover.startsWith("preset:") ? "" : form.cover}
              onChange={set("cover")}
            />
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
    </form>
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
