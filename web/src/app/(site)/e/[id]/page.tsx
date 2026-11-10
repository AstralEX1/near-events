"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, isTicket, type EventView, type GuestView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Avatar, Cover, DateBadge, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";
import { GuestGrid } from "@/components/EventParts";
import { EVENTS_CONTRACT, EXPLORER_URL } from "@/lib/config";
import { LOCAL_TZ, city, gmtLabel } from "@/lib/time";
import type { EventDetails } from "@/lib/eventImport";
import { PublicText } from "@/components/PublicText";
import { GoingList, ICONS, LocationRow, LocationSection, RegisterBox, Section } from "@/components/EventSections";
import { guestNamesApi, type GuestNames } from "@/lib/guestNamesClient";
import { useEventVisual } from "@/lib/event-visual-client";
import { VisualBackdrop } from "@/components/EventVisual";
import { cohosts as cohostsApi } from "@/lib/cohostsClient";

/**
 * The hosted event page, laid out like Luma so hosts and guests feel at home.
 * The registration card changes with your state (register → going → withdraw);
 * extras live in "…".
 */
export default function EventPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [guests, setGuests] = useState<GuestView[]>([]);
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [detailsUnavailable, setDetailsUnavailable] = useState(false);
  const [doorTeam, setDoorTeam] = useState<string[]>([]);
  const [names, setNames] = useState<GuestNames>({});
  const visual = useEventVisual(id, event?.metadata.title ?? "");

  const load = useCallback(async () => {
    setLoadError(false);
    const [e, g] = await Promise.all([
      events.get(id).catch(() => { setLoadError(true); return undefined; }),
      events.guests(id).catch(() => []),
    ]);
    setEvent(e);
    setGuests(g);
    setDetails(null);
    setDetailsUnavailable(false);
    if (e) {
      cohostsApi.get(id).then(setDoorTeam).catch(() => setDoorTeam([]));
      guestNamesApi.list(id).then(setNames).catch(() => setNames({}));
      void fetch(`/api/event-details?e=${encodeURIComponent(String(id))}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Event details are unavailable");
          return response.json();
        })
        .then((json) => {
          setDetails((json?.details as EventDetails | null | undefined) ?? null);
          setDetailsUnavailable(false);
        })
        .catch(() => {
          setDetails(null);
          setDetailsUnavailable(true);
        });
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) return <div className="card p-6 space-y-3"><h1 className="text-xl font-semibold">Couldn’t load this event</h1><p className="text-muted">Please try again in a moment.</p><button className="btn btn-accent" onClick={() => void load()}>Try again</button></div>;
  if (event === undefined) return <p className="text-muted">Loading…</p>;
  if (event === null) return <p>Event not found.</p>;

  const me = guests.find((g) => g.account_id === accountId);
  const isStaff = !!accountId && (accountId === event.host || doorTeam.includes(accountId));

  const going = guests.map((g) => g.account_id);
  const ticket = isTicket(event);
  const price = `${formatUsdc(event.deposit)} USDC`;
  const spots = Math.max(0, event.capacity - event.guest_count);
  const open = event.status === "Open";

  // Cover, hosts and who's going on the left; title, time and registration on the right.
  return (
    <>
    <VisualBackdrop visual={visual} className="gc-event-shell" themeFont>
      <div className="gc-event-content">
        <aside className="space-y-6">
          <Cover event={event} visual={visual} coverUrl={details?.cover_url} className="aspect-square w-full rounded-2xl shadow-sm" />
          <Section label="Hosted by">
            <div className="space-y-2.5">
              {[event.host, ...doorTeam].map((a, i) => (
                <Link key={a} href={`/u/${encodeURIComponent(a)}`} className="flex items-center gap-2 text-sm hover:text-accent">
                  <Avatar account={a} size={24} />
                  <span className="truncate font-medium">{shortAccount(a)}</span>
                  {i > 0 && <span className="text-xs text-muted">door</span>}
                </Link>
              ))}
            </div>
          </Section>
          <GoingList accounts={going} names={names} total={event.guest_count} verb={open ? "Going" : "Went"} />
          {isStaff && open && (
            <Link href={`/e/${id}/manage`} className="btn btn-ghost w-full">Manage event</Link>
          )}
        </aside>

        <section className="space-y-6 min-w-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              {!open && <StatusPill status={event.status} />}
              <h1 className="gc-event-title mt-1">{event.metadata.title}</h1>
            </div>
            <MoreMenu id={id} isStaff={isStaff} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <DateBadge ms={event.metadata.starts_at} />
              <div className="text-sm">
                <div className="font-medium">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
                <div className="text-muted">
                  {gmtLabel(LOCAL_TZ, event.metadata.starts_at)} · {city(LOCAL_TZ)}
                </div>
              </div>
            </div>
            {details?.location && <LocationRow value={details.location} />}
          </div>

          {me ? (
            <RegisterBox
              head={open ? "You’re in" : "Your place"}
              icon={ICONS.check}
              tone="good"
              title={ticket ? "You have a ticket" : me.status === "Attended" ? "You’re checked in" : "You’re registered"}
              desc={`${price} ${ticket ? "ticket" : "deposit"}`}
            >
              <RegistrationCard event={event} myStatus={me.status} onChange={load} explain={false} />
            </RegisterBox>
          ) : open ? (
            <RegisterBox
              head="Registration"
              aside={spots ? `${spots} spot${spots === 1 ? "" : "s"} left` : "Full"}
              icon={ticket ? ICONS.ticket : ICONS.wallet}
              title={ticket ? "Ticket" : "Attendance deposit"}
              desc={ticket ? "Goes to the host, no refunds" : "Show up, get it back + a no-show share"}
              price={price}
            >
              <RegistrationCard event={event} myStatus={null} onChange={load} explain={false} />
            </RegisterBox>
          ) : (
            <RegisterBox head={event.status === "Cancelled" ? "Cancelled" : "Event ended"}>
              <RegistrationCard event={event} myStatus={null} onChange={load} explain={false} />
            </RegisterBox>
          )}

          {details?.description && (
            <Section label="About event"><PublicText value={details.description} /></Section>
          )}
          {details?.location && <LocationSection value={details.location} />}
          {detailsUnavailable && (
            <p className="text-sm text-muted">
              Event details are temporarily unavailable. <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Retry</button>
            </p>
          )}

          {!open && <GuestGrid event={event} guests={guests} me={accountId} />}
        </section>
      </div>
    </VisualBackdrop>
    {open && !me && spots > 0 && <div className="gc-mobile-register"><span><b>{price}</b><small className="block text-muted">{ticket ? "Ticket" : "Attendance deposit"}</small></span><a href="#registration" className="btn btn-accent">{ticket ? "Get ticket" : "Register"}</a></div>}
    </>
  );
}

/** Everything secondary: share link, contract, host tools. */
function MoreMenu({ id, isStaff }: { id: number; isStaff: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const item = "block w-full text-left px-3 py-2 rounded-lg hover:bg-border/50";
  return (
    <div className="relative ml-auto shrink-0">
      <button className="w-8 h-8 rounded-lg hover:bg-border/50 text-muted" aria-label="More" onClick={() => setOpen(!open)}>
        •••
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 w-56 card p-1 shadow-xl z-20 text-sm">
            <button
              className={item}
              onClick={() =>
                navigator.clipboard.writeText(`${window.location.origin}/e/${id}`).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              {copied ? "Link copied ✓" : "Copy link"}
            </button>
            <a className={item} href={`${EXPLORER_URL}/address/${EVENTS_CONTRACT}`} target="_blank" rel="noopener">
              View contract ↗
            </a>
            {isStaff && (
              <>
                <div className="border-t border-border my-1" />
                <Link className={item} href={`/e/${id}/manage`}>Manage event</Link>
                <Link className={item} href={`/create?from=${id}`}>Duplicate event</Link>
                <Link className={item} href={`/e/${id}/manage?tab=integration`}>Add to your site</Link>
              </>
            )}
          </div>
        </>
      )}
      </div>
  );
}
