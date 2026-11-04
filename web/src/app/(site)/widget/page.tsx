"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { events, type EventView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { agentPrompt } from "@/lib/agentPrompt";

type Path = "luma" | "site";

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
  { name: "Near Events", page: "#ffffff", look: { theme: "light", accent: "#5b4bff", font: "geist", display: "sans", radius: "16" } },
  { name: "Bali Squad", page: "#fbf7f2", look: { theme: "light", accent: "#ff401f", font: "poppins", display: "serif", radius: "12" } },
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
 * Product 2 — Integrate widget.
 * Two options: Luma (payment link) · your landing (embed).
 */
export default function WidgetBuilder() {
  const { accountId } = useWallet();
  const [path, setPath] = useState<Path>("luma");
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
    const pathParam = new URLSearchParams(window.location.search).get("path");
    if (pathParam === "luma" || pathParam === "site") setPath(pathParam);
    events.list().then((l) => {
      setList(l);
      setEventId((cur) => cur || fromUrl || String(l.find((e) => e.status === "Open")?.id ?? l[0]?.id ?? ""));
    });
  }, []);

  const a = attrs(eventId, look);
  const element = `<near-event ${a.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}></near-event>`;
  const query = new URLSearchParams(a.filter(([k]) => !["event", "mode", "label"].includes(k))).toString();
  const payLink = `${origin}/p/${eventId}${look.then.trim() ? `?then=${encodeURIComponent(look.then.trim())}` : ""}`;
  const snippets = {
    script: `<script src="${origin}/embed.js" async></script>\n${element}`,
    iframe: `<iframe src="${origin}/embed/e/${eventId}${query ? `?${query}` : ""}"\n  title="Event registration" loading="lazy"\n  style="width:100%;max-width:560px;height:260px;border:0"></iframe>`,
    link: payLink,
    agent: agentPrompt(origin, eventId, element),
  };

  useEffect(() => {
    if (preview.current && eventId && path === "site") preview.current.innerHTML = element;
  }, [element, eventId, path]);

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
          Integrate
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Integrate on your site</h1>
        <p className="text-muted">
          Keep Luma or your landing as the front door. Guests leave the deposit with us. Easiest path: copy the AI prompt and paste it into Cursor or Claude.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <PathCard
          active={path === "luma"}
          title="Integrate with Luma"
          body="Paste a payment link next to your Luma register button. Deposit first, then they continue on Luma."
          onClick={() => setPath("luma")}
        />
        <PathCard
          active={path === "site"}
          title="Integrate on your landing"
          body="Embed a card or button on your site (Webflow, Tilda, WordPress, HTML)."
          onClick={() => setPath("site")}
        />
      </div>

      <Field label="Event">
        <select className="input max-w-xl" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {list.map((e) => (
            <option key={e.id} value={e.id}>
              #{e.id} {e.metadata.title}
              {mine(e) ? " · yours" : ""}
              {e.status !== "Open" ? ` · ${e.status.toLowerCase()}` : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted">
          No event yet?{" "}
          <Link href="/create" className="text-accent">
            Create event
          </Link>
          {path === "luma" && (
            <>
              {" "}
              (you can import a public lu.ma link there).
            </>
          )}
        </p>
      </Field>

      {path === "luma" ? (
        <div className="space-y-4 max-w-2xl">
          <ol className="space-y-3 text-sm text-muted list-decimal list-inside">
            <li>Create the event here (or import from Luma on Create).</li>
            <li>Copy the payment link below into your Luma description or as the main CTA instead of free RSVP.</li>
            <li>
              Optional: set “then” to your lu.ma URL so after deposit guests land back on Luma (
              <code className="text-text">{"{account}"}</code> matches payment to their entry).
            </li>
            <li>Check guests in from the event’s Manage page (or Luma Plus webhook when configured).</li>
          </ol>
          <Field label="After deposit, send guest to (optional)">
            <input
              className="input"
              type="url"
              placeholder="https://lu.ma/your-event"
              value={look.then}
              onChange={(e) => set("then", e.target.value)}
            />
          </Field>
          <Snippet title="Payment link for Luma" code={snippets.link} copied={copied === "link"} onCopy={() => copy("link")} />
        </div>
      ) : (
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
              <Segmented value={look.mode} options={[["card", "Event card"], ["button", "Just a button"]]} onChange={(v) => set("mode", v)} />
            </Field>
            {look.mode === "button" && (
              <Field label="Button text">
                <input className="input" value={look.label} maxLength={40} onChange={(e) => set("label", e.target.value)} placeholder="Register · 5 USDC" />
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
            <Snippet title="Iframe fallback" note="If your site blocks scripts." code={snippets.iframe} copied={copied === "iframe"} onCopy={() => copy("iframe")} collapsed />
            <p className="text-sm text-muted">
              Or a bare link:{" "}
              <button type="button" className="text-accent" onClick={() => copy("link")}>
                {copied === "link" ? "Copied" : "copy /p/…"}
              </button>
              . Demo:{" "}
              <a href="/demo/balisquad.html" className="text-accent" target="_blank" rel="noreferrer">
                Bali Squad
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PathCard({
  active,
  title,
  body,
  onClick,
}: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl border p-5 space-y-2 transition-colors ${
        active ? "border-accent bg-accent-soft/40" : "border-border bg-surface hover:border-accent/40"
      }`}
    >
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-muted leading-snug">{body}</p>
    </button>
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
