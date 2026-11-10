"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { LOCAL_TZ, city, gmtLabel } from "@/lib/time";
import { Avatar, DateBadge, formatWhen, shortAccount } from "@/components/ui";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";
import { PublicText } from "@/components/PublicText";
import { GoingList, ICONS, LocationRow, LocationSection, RegisterBox, Section } from "@/components/EventSections";
import { SignInOptions } from "@/components/SignIn";

/** A free event: same Luma layout as /e/<id>, but RSVP is a click, with nothing on chain. */
export default function FreeEventPage() {
  const id = useParams<{ id: string }>().id;
  const { accountId, staffToken } = useWallet();
  const [event, setEvent] = useState<FreeEvent | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/free-events?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
    if (response?.status === 404 || response?.status === 400) return setEvent(null);
    const json = await response?.json().catch(() => null);
    if (!response?.ok || !json?.event) return setError("Couldn’t load this event. Please try again in a moment.");
    setEvent(json.event as FreeEvent);
  }, [id]);
  useEffect(() => void load(), [load]);

  // Signed-in saves reuse the token from sign-in: no wallet window here.
  const post = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const token = await staffToken();
      const response = await fetch("/api/free-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Could not save. Try again.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rsvp = (going: boolean) => post({ action: going ? "join" : "leave" });

  if (event === null) return <p>Event not found.</p>;
  if (event === undefined) return error ? <p className="text-warn">{error}</p> : <p className="text-muted">Loading…</p>;

  const guests = event.guests ?? [];
  const going = !!accountId && guests.includes(accountId);
  const ended = event.ends_at < Date.now();
  const spots = Math.max(0, event.capacity - event.guest_count);
  const isHost = accountId === event.host;

  let action;
  if (going) {
    action = (
      <RegisterBox head={ended ? "You were there" : "You’re in"} icon={ICONS.check} tone="good" title={ended ? "You went ✓" : "You’re going"} desc={formatWhen(event.starts_at, event.ends_at)}>
        <button type="button" className="text-sm text-muted underline underline-offset-2 justify-self-start hover:text-text" disabled={busy} onClick={() => void rsvp(false)}>
          {busy ? "Saving…" : ended ? "I wasn’t there" : "Can’t go anymore"}
        </button>
      </RegisterBox>
    );
  } else if (spots === 0) {
    action = <RegisterBox head="Registration" aside="Full" icon={ICONS.heart} title="Event is full" desc="No spots left." />;
  } else {
    action = (
      <RegisterBox
        head={ended ? "Past event" : "Registration"}
        aside={ended ? undefined : `${spots} spot${spots === 1 ? "" : "s"} left`}
        icon={ended ? ICONS.clock : ICONS.heart}
        title={ended ? "Were you there?" : "Free"}
        desc={ended ? "Add yourself to the guest list." : "Just RSVP. No deposit, no ticket."}
      >
        {accountId ? (
          <button type="button" className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy} onClick={() => void rsvp(true)}>
            {busy ? "Saving…" : ended ? "I was there" : "Join event"}
          </button>
        ) : choosing ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Sign in to {ended ? "add yourself" : "join"}</div>
            <SignInOptions onDone={() => setChoosing(false)} />
            <button type="button" className="w-full text-xs text-muted pt-1" onClick={() => setChoosing(false)}>Back</button>
          </div>
        ) : (
          <button type="button" className="btn btn-accent w-full !py-3 text-base font-medium" onClick={() => setChoosing(true)}>
            {ended ? "I was there" : "Join event"}
          </button>
        )}
      </RegisterBox>
    );
  }

  return (
    <VisualBackdrop visual={event.visual} className="gc-event-shell">
      <div className="gc-event-content">
        <aside className="space-y-6">
          <EventPoster title={event.title} visual={event.visual} coverUrl={event.cover_url} className="aspect-square w-full rounded-2xl shadow-sm" />
          <Section label="Hosted by">
            <Link href={`/u/${encodeURIComponent(event.host)}`} className="flex items-center gap-2 text-sm hover:text-accent">
              <Avatar account={event.host} size={24} />
              <span className="truncate font-medium">{shortAccount(event.host)}</span>
            </Link>
          </Section>
          <GoingList accounts={guests} total={event.guest_count} verb={ended ? "Went" : "Going"} />
        </aside>

        <section className="space-y-6 min-w-0">
          <div className="flex items-start gap-2">
            <h1 className="gc-event-title mt-1 min-w-0">{event.title}</h1>
            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              {isHost ? (
                <button
                  type="button"
                  className="lu-chip lu-hover"
                  disabled={busy}
                  title={event.public ? "Shown in Events. Click to make it link-only." : "Only people with the link see it. Click to list it in Events."}
                  onClick={() => void post({ action: "visibility", public: !event.public })}
                >
                  {event.public ? "Public" : "Private"}
                </button>
              ) : !event.public && <span className="lu-chip">Private</span>}
              <button
                type="button"
                className="lu-chip lu-hover"
                onClick={() => navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
              >
                {copied ? "Copied ✓" : "Copy link"}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <DateBadge ms={event.starts_at} />
              <div className="text-sm">
                <div className="font-medium">{formatWhen(event.starts_at, event.ends_at)}</div>
                <div className="text-muted">{gmtLabel(LOCAL_TZ, event.starts_at)} · {city(LOCAL_TZ)}</div>
              </div>
            </div>
            {event.location && <LocationRow value={event.location} />}
          </div>

          {action}
          {error && <p className="text-sm text-warn break-words">{error}</p>}

          {event.description && <Section label="About event"><PublicText value={event.description} /></Section>}
          {event.location && <LocationSection value={event.location} />}
        </section>
      </div>
    </VisualBackdrop>
  );
}
