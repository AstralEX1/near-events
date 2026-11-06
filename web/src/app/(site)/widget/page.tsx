"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { events, type EventView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Add one registration button to an existing event page. */
export default function WidgetBuilder() {
  const { accountId } = useWallet();
  const [list, setList] = useState<EventView[]>([]);
  const [eventId, setEventId] = useState("");
  const [then, setThen] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState<"button" | "link" | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const requested = new URLSearchParams(window.location.search).get("event");
    events
      .list()
      .then(async (items) => {
        if (requested && /^(0|[1-9]\d*)$/.test(requested) && Number.isSafeInteger(Number(requested))
          && !items.some((e) => String(e.id) === requested)) {
          const event = await events.get(Number(requested));
          if (event) items = [event, ...items];
        }
        setList(items);
        setEventId((current) => {
          if (current && items.some((e) => String(e.id) === current)) return current;
          if (requested && items.some((e) => String(e.id) === requested)) return requested;
          return String(items.find((e) => e.status === "Open")?.id ?? items[0]?.id ?? "");
        });
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const selected = list.find((e) => String(e.id) === eventId);
  const thenValue = then.trim();
  const thenAttribute = thenValue ? ` then="${esc(thenValue)}"` : "";
  const buttonCode = eventId
    ? `<script src="${origin}/embed.js" async></script>\n<near-event event="${esc(eventId)}" mode="button"${thenAttribute}></near-event>`
    : "";
  const linkCode = eventId
    ? `${origin}/p/${eventId}${thenValue ? `?then=${encodeURIComponent(thenValue)}` : ""}`
    : "";

  const mine = (event: EventView) => !!accountId && (event.host === accountId || event.cohosts.includes(accountId));
  const copy = async (kind: "button" | "link") => {
    const value = kind === "button" ? buttonCode : linkCode;
    if (!selected || !value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          <Link href="/create" className="hover:text-text">← Create event</Link>
          {" · "}Integrate
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Registration button</h1>
        <p className="max-w-2xl text-muted">
          Add one button to your event page. It opens checkout on Near Me; your page stays open behind it when the browser allows a separate window.
          On phones it may open a new tab. After registering, guests can reopen the button for their QR pass or payout claim.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading events…</p>
      ) : loadError ? (
        <p className="text-sm text-warn">Could not load events. Check your connection and reload.</p>
      ) : list.length === 0 ? (
        <div className="card p-5 space-y-2">
          <p className="font-medium">Create an event to get a registration button.</p>
          <Link href="/create" className="btn btn-accent inline-flex">Create event</Link>
        </div>
      ) : (
        <div className="max-w-2xl space-y-6">
          <Field label="Event">
            <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {list.map((event) => (
                <option key={event.id} value={event.id}>
                  #{event.id} {event.metadata.title}
                  {mine(event) ? " · yours" : ""}
                  {event.status !== "Open" ? ` · ${event.status.toLowerCase()}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="After registration (optional)">
            <input
              className="input"
              type="url"
              placeholder="https://yoursite.com/your-registration-form"
              value={then}
              onChange={(e) => setThen(e.target.value)}
            />
            <p className="text-xs text-muted">Guests can continue to your existing form after they pay.</p>
          </Field>

          <Snippet
            title="Button code"
            note="After payment, the checkout shows the guest’s QR pass. This button can reopen the pass or payout page later."
            code={buttonCode}
            copied={copied === "button"}
            disabled={!selected}
            onCopy={() => copy("button")}
          />
          <Snippet
            title="Direct checkout link"
            note="Use this in a message or where your site builder does not allow scripts."
            code={linkCode}
            copied={copied === "link"}
            disabled={!selected}
            onCopy={() => copy("link")}
          />
          <p className="text-sm text-muted">
            Create events and manage guests in Near Me. On event day, guests show their QR pass; after the event closes, eligible guests can claim their payout from the same checkout page.
          </p>
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

function Snippet({
  title,
  note,
  code,
  copied,
  disabled,
  onCopy,
}: {
  title: string;
  note?: string;
  code: string;
  copied: boolean;
  disabled: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {note && <div className="text-xs text-muted">{note}</div>}
        </div>
        <button type="button" className="btn btn-ghost !py-1 !px-3 text-sm ml-auto" onClick={onCopy} disabled={disabled}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all">{code || "Choose an event first."}</pre>
    </div>
  );
}
