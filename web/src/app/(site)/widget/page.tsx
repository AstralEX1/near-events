"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { events, toUnits, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { SignInOptions } from "@/components/SignIn";
import { useWallet } from "@/lib/wallet";
import { agentPrompt } from "@/lib/agentPrompt";

interface Look {
  mode: "card" | "button";
  theme: "light" | "dark" | "auto";
  accent: string;
  font: "geist" | "poppins" | "system";
  display: "sans" | "serif";
  radius: string;
  label: string;
  then: string;
}

const PRESETS: { name: string; page: string; look: Omit<Look, "mode" | "label" | "then"> }[] = [
  { name: "Near Me", page: "#ffffff", look: { theme: "light", accent: "#5b4bff", font: "geist", display: "sans", radius: "16" } },
  { name: "Warm", page: "#fbf7f2", look: { theme: "light", accent: "#ff401f", font: "poppins", display: "serif", radius: "12" } },
  { name: "Dark", page: "#0e0e10", look: { theme: "dark", accent: "#8b7fff", font: "system", display: "sans", radius: "14" } },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function attrs(id: string, l: Look) {
  const a: [string, string][] = [["event", id]];
  if (l.mode === "button") a.push(["mode", "button"]);
  if (l.theme !== "light") a.push(["theme", l.theme]);
  if (l.accent) a.push(["accent", l.accent]);
  if (l.font !== "geist") a.push(["font", l.font]);
  if (l.display === "serif") a.push(["display", "serif"]);
  if (l.radius) a.push(["radius", l.radius]);
  if (l.mode === "button" && l.label.trim()) a.push(["label", l.label.trim()]);
  if (l.then.trim()) a.push(["then", l.then.trim()]);
  return a;
}

/**
 * Product 2: a host whose event already lives on their own site (or anywhere)
 * adds only the deposit. One short form creates the on-chain escrow under the
 * host's account (one signature); no event page here is needed.
 */
export default function WidgetBuilder() {
  const { accountId } = useWallet();
  const [list, setList] = useState<EventView[]>([]);
  const [eventId, setEventId] = useState("");
  const [look, setLook] = useState<Look>({ mode: "card", label: "", then: "", ...PRESETS[0].look });
  const [page, setPage] = useState(PRESETS[0].page);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const fromUrl = new URLSearchParams(window.location.search).get("event");
    events.list().then((l) => {
      setList(l);
      setEventId((cur) => cur || fromUrl || "");
    });
  }, []);

  const a = attrs(eventId, look);
  const element = `<near-event ${a.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}></near-event>`;
  const query = new URLSearchParams(a.filter(([k]) => !["event", "mode", "label"].includes(k))).toString();
  const payLink = `${origin}/p/${eventId}${look.then.trim() ? `?then=${encodeURIComponent(look.then.trim())}` : ""}`;
  const snippets = {
    script: `<script src="${origin}/embed.js" async></script>\n${element}`,
    iframe: `<iframe src="${origin}/embed/e/${eventId}${query ? `?${query}` : ""}"\n  title="Event deposit" loading="lazy"\n  style="width:100%;max-width:560px;height:180px;border:0"></iframe>`,
    link: payLink,
    agent: agentPrompt(origin, eventId, element),
  };

  useEffect(() => {
    if (preview.current && eventId) preview.current.innerHTML = element;
  }, [element, eventId]);

  const copy = (k: keyof typeof snippets) => {
    navigator.clipboard.writeText(snippets[k]).then(() => {
      setCopied(k);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const set = <K extends keyof Look>(k: K, v: Look[K]) => setLook((l) => ({ ...l, [k]: v }));
  const mine = (e: EventView) => !!accountId && (e.host === accountId || e.cohosts.includes(accountId));

  return (
    <div className="space-y-8">
      <Script src="/embed.js" strategy="afterInteractive" />
      <div className="max-w-2xl space-y-3">
        <p className="text-sm text-muted">
          <Link href="/create" className="hover:text-text">
            ← Create event
          </Link>
          {" · "}
          Deposit widget
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Add a deposit to your event</h1>
        <p className="text-muted">
          Your event stays on your site. Set the deposit once, then paste the widget next to your event: guests pay here and
          you check them in at the door. Easiest: copy the AI prompt into Cursor or Claude.
        </p>
      </div>

      <DepositSetup
        list={list}
        mine={mine}
        eventId={eventId}
        onPick={setEventId}
        onCreated={(id, l) => {
          setList(l);
          setEventId(id);
        }}
      />

      {eventId && (
        <p className="text-sm text-muted max-w-2xl">
          At the door, check guests in on{" "}
          <Link href={`/e/${eventId}/manage`} className="text-accent">
            your check-in page
          </Link>{" "}
          (scan their QR or tap their name). After the event, close it there and the pool is split.
        </p>
      )}

      {eventId && (
      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <div className="card p-5 space-y-4 h-fit">
          <Field label="Start from a style">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="btn btn-ghost !py-1 !px-3 text-sm"
                  onClick={() => {
                    setLook((l) => ({ ...l, ...p.look }));
                    setPage(p.page);
                  }}
                >
                  <span className="w-3 h-3 rounded-full" style={{ background: p.look.accent }} />
                  {p.name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="What to show">
            <Segmented value={look.mode} options={[["card", "Deposit box"], ["button", "Just a button"]]} onChange={(v) => set("mode", v)} />
          </Field>
          {look.mode === "button" && (
            <Field label="Button text">
              <input className="input" value={look.label} maxLength={40} onChange={(e) => set("label", e.target.value)} placeholder="Pay deposit · 5 USDC" />
            </Field>
          )}
          <Field label="After deposit → (optional)">
            <input
              className="input"
              type="url"
              placeholder="https://yoursite.com/thanks"
              value={look.then}
              onChange={(e) => set("then", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Accent">
              <input className="input !p-1 h-10" type="color" value={look.accent} onChange={(e) => set("accent", e.target.value)} />
            </Field>
            <Field label="Corners (px)">
              <input className="input" type="number" min="0" max="32" value={look.radius} onChange={(e) => set("radius", e.target.value)} />
            </Field>
          </div>
          <Field label="Theme">
            <Segmented value={look.theme} options={[["light", "Light"], ["dark", "Dark"], ["auto", "Auto"]]} onChange={(v) => set("theme", v)} />
          </Field>
          <Field label="Font">
            <Segmented value={look.font} options={[["geist", "Geist"], ["poppins", "Poppins"], ["system", "System"]]} onChange={(v) => set("font", v)} />
          </Field>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-border p-6 sm:p-10 transition-colors" style={{ background: page }}>
            <div className="text-xs mb-3" style={{ color: page === "#0e0e10" ? "#9a9aa6" : "#6b6b76" }}>
              Preview on your page
            </div>
            <div ref={preview} />
          </div>
          <Snippet
            title="AI prompt (easiest)"
            note="Paste into Cursor, Claude, or ChatGPT with your site open. It adds the widget for you."
            code={snippets.agent}
            copied={copied === "agent"}
            onCopy={() => copy("agent")}
          />
          <Snippet title="Or paste this code yourself" note="Sign-up opens in a small window on our domain." code={snippets.script} copied={copied === "script"} onCopy={() => copy("script")} />
          <Snippet
            title="Bare payment link"
            note="Paste into Instagram, WhatsApp, or any CTA when you don’t need the widget."
            code={snippets.link}
            copied={copied === "link"}
            onCopy={() => copy("link")}
          />
          <Snippet title="Iframe fallback" note="If your site blocks scripts." code={snippets.iframe} copied={copied === "iframe"} onCopy={() => copy("iframe")} collapsed />
        </div>
      </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl border border-border p-0.5 text-sm">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-1.5 ${value === v ? "bg-accent-soft text-accent font-medium" : "text-muted"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Snippet({
  title,
  note,
  code,
  copied,
  onCopy,
  collapsed,
}: {
  title: string;
  note?: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
  collapsed?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {note && <div className="text-xs text-muted">{note}</div>}
        </div>
        <button type="button" className="btn btn-ghost !py-1 !px-3 text-sm ml-auto" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={`p-4 text-xs font-mono overflow-x-auto ${collapsed ? "whitespace-pre-wrap max-h-40 overflow-y-auto" : "whitespace-pre"}`}>
        {code}
      </pre>
    </div>
  );
}

/** Pick one of your deposits, or set up a new one for an event that lives elsewhere. */
function DepositSetup({
  list,
  mine,
  eventId,
  onPick,
  onCreated,
}: {
  list: EventView[];
  mine: (e: EventView) => boolean;
  eventId: string;
  onPick: (id: string) => void;
  onCreated: (id: string, list: EventView[]) => void;
}) {
  const { accountId, send } = useWallet();
  const own = list.filter(mine);
  const [tab, setTab] = useState<"new" | "existing">("new");
  const [f, setF] = useState({ link: "", title: "", start: "", deposit: "5", capacity: "50" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  // An event id in the link (?event=3) means the host already has one: show it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("event")) setTab("existing");
  }, []);
  // Picking from the list: start with your newest open deposit.
  useEffect(() => {
    if (tab !== "existing" || eventId) return;
    const first = own.find((e) => e.status === "Open") ?? own[0] ?? list[0];
    if (first) onPick(String(first.id));
  }, [tab, eventId, own, list, onPick]);

  const startMs = f.start ? new Date(f.start).getTime() : NaN; // the host's local time
  const link = f.link.trim();
  const linkOk = !link || /^https?:\/\/\S+$/i.test(link);
  const valid = f.title.trim() && Number.isFinite(startMs) && startMs > Date.now() && Number(f.deposit) >= 0.1 && Number(f.capacity) >= 1 && Number(f.capacity) <= 300 && linkOk;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const title = f.title.trim().slice(0, 120);
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              // The event's own page stays the source of truth; we keep only a link to it.
              description: link ? `Event page: ${link.slice(0, 1000)}` : "",
              location: "",
              cover_url: null,
              starts_at: startMs,
              ends_at: startMs + 3 * 3600_000,
            },
            deposit: toUnits(f.deposit),
            capacity: Math.floor(Number(f.capacity)),
            mode: "Deposit",
          },
        },
      ]);
      const l = await events.list();
      const made = l.find((ev) => ev.host === accountId && ev.metadata.title === title && ev.metadata.starts_at === startMs);
      if (!made) throw new Error("Set up, but it isn’t visible yet. Reload in a minute and pick it under “I already have one”.");
      onCreated(String(made.id), l);
      setTab("existing");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5 space-y-4 max-w-2xl">
      <Segmented
        value={tab}
        options={[["new", "Set up a deposit"], ["existing", "I already have one"]]}
        onChange={setTab}
      />
      {tab === "existing" ? (
        <Field label="Deposit">
          <select className="input" value={eventId} onChange={(e) => onPick(e.target.value)}>
            {(own.length ? own : list).map((e) => (
              <option key={e.id} value={e.id}>
                #{e.id} {e.metadata.title}
                {mine(e) ? " · yours" : ""}
                {e.status !== "Open" ? ` · ${e.status.toLowerCase()}` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <form className="space-y-4" onSubmit={create}>
          <p className="text-sm text-muted">
            Your event page stays where it is. We only hold the deposits, under your account.
          </p>
          <Field label="Link to your event page (optional)">
            <input className="input" type="url" placeholder="https://yoursite.com/events/meetup" value={f.link} onChange={set("link")} />
          </Field>
          <Field label="Event name (guests see it when they pay)">
            <input className="input" maxLength={120} placeholder="Builders meetup" value={f.title} onChange={set("title")} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Starts">
              <input className="input" type="datetime-local" value={f.start} onChange={set("start")} required />
            </Field>
            <Field label="Deposit, USDC">
              <input className="input" type="number" min="0.1" step="0.1" value={f.deposit} onChange={set("deposit")} required />
            </Field>
            <Field label="Seats (max 300)">
              <input className="input" type="number" min="1" max="300" value={f.capacity} onChange={set("capacity")} required />
            </Field>
          </div>
          {!accountId ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Sign in once. The deposits and payouts stay under your account.</p>
              <SignInOptions />
            </div>
          ) : (
            <button className="btn btn-accent w-full sm:w-auto" disabled={busy || !valid}>
              {busy ? "Confirm in your wallet…" : "Set up deposit"}
            </button>
          )}
          {error && <p className="text-sm text-warn break-words">{error}</p>}
          <p className="text-xs text-muted">
            Free, up to 5 open deposits at a time. Guests who show up get their deposit back plus a share of the no-shows.
          </p>
        </form>
      )}
    </div>
  );
}
