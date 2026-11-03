"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { events, type EventView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

interface Look {
  mode: "card" | "button";
  theme: "light" | "dark" | "auto";
  accent: string;
  font: "geist" | "poppins" | "system";
  display: "sans" | "serif";
  radius: string;
  label: string;
}

const PRESETS: { name: string; page: string; look: Omit<Look, "mode" | "label"> }[] = [
  { name: "Near Events", page: "#f6f5f2", look: { theme: "light", accent: "#5b4bff", font: "geist", display: "sans", radius: "16" } },
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
  return a;
}

/** Host onboarding: pick an event, match your brand, copy one snippet. */
export default function WidgetBuilder() {
  const { accountId } = useWallet();
  const [list, setList] = useState<EventView[]>([]);
  const [eventId, setEventId] = useState("");
  const [look, setLook] = useState<Look>({ mode: "card", label: "", ...PRESETS[0].look });
  const [page, setPage] = useState(PRESETS[0].page);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const preview = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const fromUrl = new URLSearchParams(window.location.search).get("event");
    events.list().then((l) => {
      setList(l);
      setEventId((cur) => cur || fromUrl || String(l.find((e) => e.status === "Open")?.id ?? l[0]?.id ?? ""));
    });
  }, []);

  const a = attrs(eventId, look);
  const element = `<near-event ${a.map(([k, v]) => `${k}="${esc(v)}"`).join(" ")}></near-event>`;
  const query = new URLSearchParams(a.filter(([k]) => !["event", "mode", "label"].includes(k))).toString();
  const snippets = {
    script: `<script src="${origin}/embed.js" async></script>\n${element}`,
    iframe: `<iframe src="${origin}/embed/e/${eventId}${query ? `?${query}` : ""}"\n  title="Event registration" loading="lazy"\n  style="width:100%;max-width:560px;height:260px;border:0"></iframe>`,
    link: `${origin}/e/${eventId}`,
  };

  // The preview is the exact snippet, run through the same embed.js.
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
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Put your event on your website</h1>
        <p className="text-muted mt-2">
          Paste two lines into any site (Webflow, Tilda, WordPress, Wix, plain HTML). Guests register and pay the deposit
          without leaving your page. The money is held by the Near Events contract, not by us, and there is no fee.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-4 text-sm">
        {[
          ["Create the event", <>On <Link href="/create" className="text-accent">Create event</Link>, or through your DAO.</>],
          ["Pick it and match your brand", "Colors, font and corners below. The preview is live."],
          ["Paste the code", "Into your site, where the event should appear."],
          ["Check guests in", "On the event day, from the event’s Manage page."],
        ].map(([t, d], i) => (
          <li key={i} className="card p-4">
            <div className="text-accent font-semibold">{i + 1}</div>
            <div className="font-medium mt-1">{t}</div>
            <div className="text-muted mt-1">{d}</div>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <div className="card p-5 space-y-4 h-fit">
          <Field label="Event">
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {list.map((e) => (
                <option key={e.id} value={e.id}>
                  #{e.id} {e.metadata.title}
                  {mine(e) ? " · yours" : ""}
                  {e.status !== "Open" ? ` · ${e.status.toLowerCase()}` : ""}
                </option>
              ))}
            </select>
          </Field>
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
            <Field label="Button text (empty = “Register · 5 USDC”)">
              <input className="input" value={look.label} maxLength={40} onChange={(e) => set("label", e.target.value)} />
            </Field>
          )}
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
          <Field label="Event title">
            <Segmented value={look.display} options={[["sans", "Same font"], ["serif", "Serif"]]} onChange={(v) => set("display", v)} />
          </Field>
        </div>

        <div className="space-y-4 min-w-0">
          <div className="rounded-2xl border border-border p-6 sm:p-10 transition-colors" style={{ background: page }}>
            <div className="text-xs mb-3" style={{ color: page === "#0e0e10" ? "#9a9aa6" : "#6b6b76" }}>Preview on your page</div>
            <div ref={preview} />
          </div>
          <Snippet title="Embed code (recommended)" note="Card resizes itself; sign-up opens in a small window where wallets and Google sign-in just work." code={snippets.script} copied={copied === "script"} onCopy={() => copy("script")} />
          <Snippet title="No scripts allowed? Use an iframe" note="Same card. Set the height yourself." code={snippets.iframe} copied={copied === "iframe"} onCopy={() => copy("iframe")} />
          <Snippet title="Or just share the link" code={snippets.link} copied={copied === "link"} onCopy={() => copy("link")} />
          <p className="text-sm text-muted">
            Developers: listen for <code className="text-text">registered</code> on the element, or call{" "}
            <code className="text-text">NearEvents.open({eventId || "id"})</code> from your own button. See{" "}
            <a href="/demo/balisquad.html" className="text-accent" target="_blank">the Bali Squad demo page</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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

function Snippet({ title, note, code, copied, onCopy }: { title: string; note?: string; code: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {note && <div className="text-xs text-muted">{note}</div>}
        </div>
        <button className="btn btn-ghost !py-1 !px-3 text-sm ml-auto" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className="p-4 text-xs font-mono overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}
