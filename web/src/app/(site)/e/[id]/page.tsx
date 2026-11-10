"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, isTicket, type EventView, type GuestView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Avatar, AvatarStack, Cover, DateBadge, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";
import { GuestGrid } from "@/components/EventParts";
import { EVENTS_CONTRACT, EXPLORER_URL } from "@/lib/config";
import { LOCAL_TZ, city, gmtLabel } from "@/lib/time";
import type { EventDetails } from "@/lib/eventImport";
import { LocationValue, PublicText } from "@/components/PublicText";
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

  // Cover, hosts and who's going on the left; title, time and registration on the right.
  return (
    <>
    <VisualBackdrop visual={visual} className="gc-event-shell" themeFont>
      <div className="gc-event-content">
        <aside className="space-y-6">
          <Cover event={event} visual={visual} coverUrl={details?.cover_url} className="aspect-square w-full rounded-2xl shadow-sm" />
          <div>
            <div className="label pb-2 mb-3 border-b border-border">Hosted by</div>
            <div className="space-y-2.5">
              {[event.host, ...doorTeam].map((a, i) => (
                <Link key={a} href={`/u/${encodeURIComponent(a)}`} className="flex items-center gap-2 text-sm hover:text-accent">
                  <Avatar account={a} size={24} />
                  <span className="truncate font-medium">{shortAccount(a)}</span>
                  {i > 0 && <span className="text-xs text-muted">door</span>}
                </Link>
              ))}
            </div>
          </div>
          {going.length > 0 && (
            <div>
              <div className="label pb-2 mb-3 border-b border-border">{event.guest_count} going</div>
              <AvatarStack accounts={going} max={9} linked />
            </div>
          )}
          {isStaff && event.status === "Open" && (
            <Link href={`/e/${id}/manage`} className="btn btn-ghost w-full">Manage event</Link>
          )}
        </aside>

        <section className="space-y-6 min-w-0">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              {event.status !== "Open" && <StatusPill status={event.status} />}
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
            <div className="text-sm text-muted">
              {event.guest_count} going{event.status === "Open" && ` · ${Math.max(0, event.capacity - event.guest_count)} spot${event.capacity - event.guest_count === 1 ? "" : "s"} left`}
            </div>
          </div>

          <div id="registration" className="gc-registration space-y-4">
            <div>
              <p className="gc-eyebrow">{me ? "Your place" : isTicket(event) ? "Paid ticket" : "Attendance deposit"}</p>
              {!me && <p className="gc-price mt-1">{formatUsdc(event.deposit)} <span className="text-base text-muted">USDC</span></p>}
            </div>
            <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />
          </div>

          {(details?.location || details?.description) && (
            <div className="card p-4 space-y-4">
              {details.location && (
                <section className="space-y-1">
                  <h2 className="font-medium">Location</h2>
                  <LocationValue value={details.location} />
                </section>
              )}
              {details.description && (
                <section className="space-y-1">
                  <h2 className="font-medium">Event details</h2>
                  <PublicText value={details.description} />
                </section>
              )}
            </div>
          )}
          {detailsUnavailable && (
            <p className="text-sm text-muted">
              Event details are temporarily unavailable. <button type="button" className="underline underline-offset-2" onClick={() => void load()}>Retry</button>
            </p>
          )}



          {event.status !== "Open" && <GuestGrid event={event} guests={guests} me={accountId} />}
        </section>
      </div>
    </VisualBackdrop>
    {event.status === "Open" && !me && event.guest_count < event.capacity && <div className="gc-mobile-register"><span><b>{formatUsdc(event.deposit)} USDC</b><small className="block text-muted">{isTicket(event) ? "Paid ticket" : "Attendance deposit"}</small></span><a href="#registration" className="btn btn-accent">{isTicket(event) ? "Get a ticket" : "Join event"}</a></div>}
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
