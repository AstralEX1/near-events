"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { events, type EventView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { detectEventSource } from "@/lib/eventImport";
import { aiPrompt, buttonCode, checkoutLink } from "@/lib/integration";
import { Snippet } from "@/components/Snippet";

// /widget starts the Integrate flow; /widget?event=<id> is the setup for an event that already exists.
export default function WidgetPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <WidgetRoute />
    </Suspense>
  );
}

function WidgetRoute() {
  const requested = useSearchParams().get("event");
  return requested ? <WidgetBuilder requested={requested} /> : <IntegrateStart />;
}

/** First step of the Integrate flow: one event link, then the prefilled creation form. */
function IntegrateStart() {
  const router = useRouter();
  const [link, setLink] = useState("");
  const source = detectEventSource(link);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (source) router.push(`/create?flow=widget&import=${encodeURIComponent(link.trim())}`);
  };

  return (
    <form onSubmit={submit} className="max-w-2xl mx-auto space-y-4 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">Add registration to your site</h1>
      <label className="block space-y-1.5">
        <span className="flex items-baseline justify-between gap-3" aria-live="polite">
          <span className="label">Luma or BaliSquad event link</span>
          {source && <span className="text-sm text-good">✓ {source}</span>}
          {!source && link.trim() && <span className="text-sm text-warn">Not supported</span>}
        </span>
        <input
          autoFocus
          className="lu-field w-full px-3 py-2 text-sm"
          inputMode="url"
          autoComplete="off"
          placeholder="https://lu.ma/your-event"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={!source}>
        Continue
      </button>
    </form>
  );
}

/** Add one registration button to an existing event page. */
function WidgetBuilder({ requested }: { requested: string }) {
  const { accountId } = useWallet();
  const [list, setList] = useState<EventView[]>([]);
  const [eventId, setEventId] = useState("");
  const [then, setThen] = useState("");
  const [origin, setOrigin] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    events
      .list()
      .then(async (items) => {
        if (/^(0|[1-9]\d*)$/.test(requested) && Number.isSafeInteger(Number(requested))
          && !items.some((e) => String(e.id) === requested)) {
          const event = await events.get(Number(requested));
          if (event) items = [event, ...items];
        }
        setList(items);
        setEventId((current) => {
          if (current && items.some((e) => String(e.id) === current)) return current;
          if (items.some((e) => String(e.id) === requested)) return requested;
          return String(items.find((e) => e.status === "Open")?.id ?? items[0]?.id ?? "");
        });
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [requested]);

  const selected = list.find((e) => String(e.id) === eventId);
  const target = { origin, eventId, then: then.trim() };

  const mine = (event: EventView) => !!accountId && (event.host === accountId || event.cohosts.includes(accountId));

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">Registration button</h1>

      {loading ? (
        <p className="text-sm text-muted">Loading events…</p>
      ) : loadError ? (
        <p className="text-sm text-warn">Could not load events. Check your connection and reload.</p>
      ) : list.length === 0 ? (
        <Link href="/create" className="btn btn-accent inline-flex">Create event</Link>
      ) : (
        <div className="space-y-6">
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
          </Field>

          <Snippet
            title="Button code"
            code={eventId ? buttonCode(target) : ""}
            disabled={!selected}
            placeholder="Choose an event first."
          />
          <Snippet
            title="AI prompt"
            code={selected ? aiPrompt(target, selected.mode ?? "Deposit") : ""}
            long
            placeholder="Choose an event first."
          />
          <Snippet
            title="Direct checkout link"
            code={eventId ? checkoutLink(target) : ""}
            disabled={!selected}
            placeholder="Choose an event first."
          />
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
