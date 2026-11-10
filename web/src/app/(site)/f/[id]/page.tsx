"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { LOCAL_TZ, city, gmtLabel } from "@/lib/time";
import { Avatar, AvatarStack, DateBadge, formatWhen, shortAccount } from "@/components/ui";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";
import { LocationValue, PublicText } from "@/components/PublicText";
import { SignInMenu } from "@/components/SignIn";

/** A free event: same Luma layout as /e/<id>, but RSVP is a click, with nothing on chain. */
export default function FreeEventPage() {
  const id = useParams<{ id: string }>().id;
  const { accountId, staffToken } = useWallet();
  const [event, setEvent] = useState<FreeEvent | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/free-events?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
    if (response?.status === 404 || response?.status === 400) return setEvent(null);
    const json = await response?.json().catch(() => null);
    if (!response?.ok || !json?.event) return setError("Couldn’t load this event. Please try again in a moment.");
    setEvent(json.event as FreeEvent);
  }, [id]);
  useEffect(() => void load(), [load]);

  const rsvp = async (going: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const token = await staffToken();
      const response = await fetch("/api/free-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: going ? "join" : "leave", id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Could not save your RSVP");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (event === null) return <p>Event not found.</p>;
  if (event === undefined) return error ? <p className="text-warn">{error}</p> : <p className="text-muted">Loading…</p>;

  const guests = event.guests ?? [];
  const going = !!accountId && guests.includes(accountId);
  const ended = event.ends_at < Date.now();
  const full = event.guest_count >= event.capacity;

  return (
    <VisualBackdrop visual={event.visual} className="gc-event-shell">
      <div className="gc-event-content">
        <aside className="space-y-6">
          <EventPoster title={event.title} visual={event.visual} coverUrl={event.cover_url} className="aspect-square w-full rounded-2xl shadow-sm" />
          <div>
            <div className="label pb-2 mb-3 border-b border-border">Hosted by</div>
            <Link href={`/u/${encodeURIComponent(event.host)}`} className="flex items-center gap-2 text-sm hover:text-accent">
              <Avatar account={event.host} size={24} />
              <span className="truncate font-medium">{shortAccount(event.host)}</span>
            </Link>
          </div>
          {guests.length > 0 && (
            <div>
              <div className="label pb-2 mb-3 border-b border-border">{event.guest_count} {ended ? "went" : "going"}</div>
              <AvatarStack accounts={guests} max={9} linked />
            </div>
          )}
        </aside>

        <section className="space-y-6 min-w-0">
          <div className="flex items-start gap-2">
            <h1 className="gc-event-title mt-1 min-w-0">{event.title}</h1>
            <button
              type="button"
              className="ml-auto shrink-0 btn btn-ghost !py-1.5 text-sm"
              onClick={() => navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <DateBadge ms={event.starts_at} />
              <div className="text-sm">
                <div className="font-medium">{formatWhen(event.starts_at, event.ends_at)}</div>
                <div className="text-muted">{gmtLabel(LOCAL_TZ, event.starts_at)} · {city(LOCAL_TZ)}</div>
              </div>
            </div>
            <div className="text-sm text-muted">
              {event.guest_count} {ended ? "went" : "going"}{!ended && ` · ${Math.max(0, event.capacity - event.guest_count)} spots left`}
              {!event.public && " · Private, only people with the link see it"}
            </div>
          </div>

          <div id="registration" className="gc-registration space-y-4">
            <div>
              <p className="gc-eyebrow">{going ? "Your place" : ended ? "Past event" : "Registration"}</p>
              {!going && <p className="gc-price mt-1">Free</p>}
            </div>
            {going ? (
              <div className="space-y-3">
                <p className="text-good font-medium">{ended ? "You were there ✓" : "You’re going ✓"}</p>
                <button type="button" className="btn btn-ghost w-full" disabled={busy} onClick={() => void rsvp(false)}>{busy ? "Saving…" : ended ? "I wasn’t there" : "Can’t go anymore"}</button>
              </div>
            ) : full ? (
              <p className="text-muted">This event is full.</p>
            ) : accountId ? (
              <button type="button" className="btn btn-accent w-full !py-3" disabled={busy} onClick={() => void rsvp(true)}>
                {busy ? "Saving…" : ended ? "I was there" : "Join event"}
              </button>
            ) : (
              <div className="space-y-2"><p className="text-sm text-muted">{ended ? "Were you there? Sign in to add yourself." : "Sign in to join. No deposit, no ticket."}</p><SignInMenu /></div>
            )}
            {error && <p className="text-sm text-warn break-words">{error}</p>}
          </div>

          {(event.location || event.description) && (
            <div className="card p-4 space-y-4">
              {event.location && (
                <section className="space-y-1">
                  <h2 className="font-medium">Location</h2>
                  <LocationValue value={event.location} />
                </section>
              )}
              {event.description && (
                <section className="space-y-1">
                  <h2 className="font-medium">Event details</h2>
                  <PublicText value={event.description} />
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </VisualBackdrop>
  );
}
