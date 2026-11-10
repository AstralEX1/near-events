"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useFreeEvent } from "@/lib/freeEventsClient";
import { Avatar, formatWhen, shortAccount } from "@/components/ui";

type Tab = "overview" | "guests" | "registration";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "guests", label: "Guests" },
  { id: "registration", label: "Registration" },
];

/** Host admin for a free event: the same Manage look as /e/<id>/manage, without money or chain steps. */
export default function ManageFreeEventPage() {
  const id = useParams<{ id: string }>().id;
  const { accountId, event, busy, error, post } = useFreeEvent(id);
  const [tab, setTab] = useState<Tab>("overview");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  if (event === null) return <p className="px-1">Event not found.</p>;
  if (event === undefined) return <p className="text-muted px-1" role="status">{error ?? "Loading…"}</p>;
  if (accountId !== event.host) {
    return (
      <p className="px-1">
        Only the host can manage this event. <Link href={`/f/${id}`} className="text-accent">Back to event</Link>
      </p>
    );
  }

  const guests = event.guests ?? [];
  const requests = event.requests ?? [];
  const spots = Math.max(0, event.capacity - event.guest_count);
  const pageUrl = `${origin}/f/${id}`;
  const q = query.trim().toLowerCase();
  const shown = q ? guests.filter((a) => a.toLowerCase().includes(q)) : guests;

  const copy = () => navigator.clipboard.writeText(pageUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  const exportCsv = () => {
    const csv = ["account", ...guests].map((c) => `"${c.replace(/"/g, '""')}"`).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `event-${id}-guests.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const requestsBlock = event.approval && (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Requests{requests.length ? ` · ${requests.length}` : ""}</h2>
      {requests.length ? (
        <ul className="card divide-y divide-border">
          {requests.map((guest) => (
            <li key={guest} className="flex items-center gap-3 px-3 sm:px-4 min-h-14 py-2">
              <Avatar account={guest} size={36} />
              <span className="min-w-0 flex-1 truncate font-medium" data-tooltip={guest}>{shortAccount(guest)}</span>
              <button type="button" className="btn btn-ghost !py-2 !px-3 text-sm" disabled={busy} onClick={() => void post({ action: "decline", guest })}>Decline</button>
              <button type="button" className="btn btn-accent !py-2 !px-3 text-sm" disabled={busy || spots === 0} data-tooltip={spots === 0 ? "The event is full" : undefined} onClick={() => void post({ action: "approve", guest })}>Approve</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="card p-4 text-sm text-muted">No requests yet. Guests who ask to join show up here.</p>
      )}
    </section>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-7 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            <Link href="/events" className="hover:text-text">Events</Link>
            <span className="mx-1.5 opacity-50">›</span>
            <span>Manage</span>
          </p>
          <h1 className="gc-page-title break-words mt-1">{event.title}</h1>
        </div>
        <Link href={`/f/${id}`} className="btn btn-ghost !py-2 text-sm shrink-0" target="_blank">Event Page ↗</Link>
      </div>

      <nav className="gc-manage-tabs" aria-label="Manage sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-pressed={tab === t.id}>{t.label}</button>
        ))}
      </nav>

      {error && <p className="text-sm text-warn break-words card p-3">{error}</p>}

      {tab === "overview" && (
        <div className="space-y-8">
          <div className="gc-host-stats">
            <div className="gc-host-stat"><span>Going</span><div className="text-2xl font-semibold mt-1">{event.guest_count} / {event.capacity}</div></div>
            <div className="gc-host-stat"><span>Requests</span><div className="text-2xl font-semibold mt-1">{event.approval ? requests.length : "Off"}</div></div>
            <div className="gc-host-stat"><span>Visibility</span><div className="text-2xl font-semibold mt-1">{event.public ? "Public" : "Private"}</div></div>
          </div>
          <div className="card p-4 text-sm">
            <div className="font-medium">{formatWhen(event.starts_at, event.ends_at)}</div>
            {event.location && <div className="text-muted mt-0.5 break-words">{event.location}</div>}
          </div>
          {requestsBlock}
        </div>
      )}

      {tab === "guests" && (
        <div className="space-y-6">
          {requestsBlock}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Guest List · {guests.length}</h2>
              {guests.length > 0 && <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={exportCsv}>Download CSV</button>}
            </div>
            <input className="input" placeholder="Find by account" aria-label="Find guest" value={query} onChange={(e) => setQuery(e.target.value)} />
            {shown.length === 0 ? (
              <div className="card py-14 px-6 text-center space-y-2">
                <h3 className="font-semibold">{guests.length ? "Nobody matches" : "No Guests Yet"}</h3>
                {!guests.length && <p className="text-sm text-muted max-w-sm mx-auto">Share the event link so people can join.</p>}
              </div>
            ) : (
              <ul className="card divide-y divide-border">
                {shown.map((a) => (
                  <li key={a}>
                    <Link href={`/u/${encodeURIComponent(a)}`} className="flex items-center gap-3 px-3 sm:px-4 min-h-14 py-2 hover:text-accent">
                      <Avatar account={a} size={36} />
                      <span className="min-w-0 flex-1 truncate font-medium" data-tooltip={a}>{shortAccount(a)}</span>
                      {a === event.host && <span className="text-xs text-muted">host</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === "registration" && (
        <div className="space-y-6">
          <section className="card p-4 space-y-1">
            <div className="font-medium">{event.approval ? "Free · host approves each guest" : "Free · anyone can join"}</div>
            <p className="text-sm text-muted">No deposit, no ticket, nothing on chain. {event.capacity} spots, {spots} left.</p>
          </section>
          <section className="card p-4 flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{event.public ? "Public" : "Private"}</div>
              <p className="text-sm text-muted">{event.public ? "Shown in Events for everyone." : "Only people with the link see it."}</p>
            </div>
            <button type="button" className="btn btn-ghost !py-2 text-sm" disabled={busy} onClick={() => void post({ action: "visibility", public: !event.public })}>
              {event.public ? "Make private" : "Make public"}
            </button>
          </section>
          <section className="card p-3 sm:p-4 space-y-2">
            <div className="text-sm font-medium">Event page</div>
            <div className="flex gap-2">
              <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{pageUrl || "…"}</code>
              <button type="button" className="btn btn-ghost !py-1.5 text-sm shrink-0" onClick={copy} disabled={!origin}>{copied ? "Copied" : "Copy"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
