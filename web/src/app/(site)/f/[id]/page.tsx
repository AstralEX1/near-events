"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageSkeleton, SlShare } from "@/components/SlUi";
import { useFreeEvent } from "@/lib/freeEventsClient";
import { LOCAL_TZ, city, gmtLabel } from "@/lib/time";
import { Avatar, DateBadge, formatWhen, shortAccount } from "@/components/ui";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";
import { PublicText } from "@/components/PublicText";
import { GoingList, ICONS, LocationRow, LocationSection, RegisterBox, Section } from "@/components/EventSections";
import { SignInOptions } from "@/components/SignIn";

/** A free event: same Luma layout as /e/<id>, but RSVP is a click, with nothing on chain. */
export default function FreeEventPage() {
  const id = useParams<{ id: string }>().id;
  const { accountId, event, busy, error, post } = useFreeEvent(id);
  const [choosing, setChoosing] = useState(false);

  const rsvp = (going: boolean) =>
    post({ action: going ? "join" : "leave" }, going ? (event?.approval && accountId !== event.host ? "Request sent" : "You’re going") : event?.requested ? "Request canceled" : "Removed from the guest list");

  if (event === null) return <p>Event not found.</p>;
  if (event === undefined) return error ? <p className="text-warn">{error}</p> : <PageSkeleton />;

  const guests = event.guests ?? [];
  const going = !!accountId && guests.includes(accountId);
  const ended = event.ends_at < Date.now();
  const spots = Math.max(0, event.capacity - event.guest_count);
  const isHost = accountId === event.host;
  const needsApproval = !!event.approval && !isHost;

  let action;
  if (going) {
    action = (
      <RegisterBox head={ended ? "You were there" : "You’re in"} icon={ICONS.check} tone="good" title={ended ? "You went ✓" : "You’re going"} desc={formatWhen(event.starts_at, event.ends_at)}>
        <button type="button" className="text-sm text-muted underline underline-offset-2 justify-self-start hover:text-text" disabled={busy} onClick={() => void rsvp(false)}>
          {busy ? "Saving…" : ended ? "I wasn’t there" : "Can’t go anymore"}
        </button>
      </RegisterBox>
    );
  } else if (event.requested) {
    action = (
      <RegisterBox head="Registration" aside="Pending" icon={ICONS.clock} title="Request sent" desc="The host will review it. Check back here.">
        <button type="button" className="text-sm text-muted underline underline-offset-2 justify-self-start hover:text-text" disabled={busy} onClick={() => void rsvp(false)}>
          {busy ? "Saving…" : "Cancel request"}
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
        title={ended ? "Were you there?" : needsApproval ? "Approval required" : "Free"}
        desc={ended ? (needsApproval ? "Ask the host to add you to the guest list." : "Add yourself to the guest list.") : needsApproval ? "Free. The host approves each guest." : "Just RSVP. No deposit, no ticket."}
      >
        {accountId ? (
          <button type="button" className="btn btn-accent w-full !py-3 text-base font-medium" disabled={busy} onClick={() => void rsvp(true)}>
            {busy ? "Saving…" : needsApproval ? "Request to join" : ended ? "I was there" : "Join event"}
          </button>
        ) : choosing ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Sign in to {needsApproval ? "request a spot" : ended ? "add yourself" : "join"}</div>
            <SignInOptions onDone={() => setChoosing(false)} />
            <button type="button" className="w-full text-xs text-muted pt-1" onClick={() => setChoosing(false)}>Back</button>
          </div>
        ) : (
          <button type="button" className="btn btn-accent w-full !py-3 text-base font-medium" onClick={() => setChoosing(true)}>
            {needsApproval ? "Request to join" : ended ? "I was there" : "Join event"}
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
          {isHost && (
            <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm">
              <span className="min-w-0 flex-1 text-muted">
                You have manage access for this event.{event.approval && event.requests?.length ? ` ${event.requests.length} waiting for approval.` : ""}
              </span>
              <Link href={`/f/${id}/manage`} className="btn btn-accent shrink-0">Manage</Link>
            </div>
          )}
          <div className="flex items-start gap-2">
            <h1 className="gc-event-title mt-1 min-w-0">{event.title}</h1>
            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              {!event.public && <span className="lu-chip">Private</span>}
              <SlShare url={`${typeof window === "undefined" ? "" : window.location.origin}/f/${id}`} />
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
