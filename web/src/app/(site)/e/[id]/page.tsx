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

/**
 * The hosted event page, laid out like Luma so hosts and guests feel at home.
 * The registration card changes with your state (register → going → withdraw);
 * extras live in "…".
 */
export default function EventPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [guests, setGuests] = useState<GuestView[]>([]);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([events.get(id), events.guests(id).catch(() => [])]);
    setEvent(e);
    setGuests(g);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (event === undefined) return <p className="text-muted">Loading…</p>;
  if (event === null) return <p>Event not found.</p>;

  const me = guests.find((g) => g.account_id === accountId);
  const isStaff = !!accountId && (accountId === event.host || event.cohosts.includes(accountId));

  const going = guests.map((g) => g.account_id);

  // Cover, hosts and who's going on the left; title, time and registration on the right.
  return (
    <div className="grid gap-8 md:grid-cols-[330px_1fr] items-start max-w-[928px] mx-auto">
        <aside className="space-y-6">
          <Cover event={event} className="aspect-square w-full rounded-2xl shadow-sm [&>span]:hidden" />
          <div>
            <div className="label pb-2 mb-3 border-b border-border">Hosted by</div>
            <div className="space-y-2.5">
              {[event.host, ...event.cohosts].map((a, i) => (
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
              <AvatarStack accounts={going} max={9} />
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
              <h1 className="text-3xl sm:text-[40px] sm:leading-[1.15] font-semibold tracking-tight mt-1">{event.metadata.title}</h1>
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
              {isTicket(event)
                ? `${formatUsdc(event.deposit)} USDC ticket`
                : `${formatUsdc(event.deposit)} USDC deposit · pool ${formatUsdc(event.total_pool)} USDC`}
            </div>
          </div>

          <div className="card overflow-hidden bg-surface/80 backdrop-blur">
            <div className="px-4 py-2.5 text-sm font-medium text-muted border-b border-border">Registration</div>
            <div className="p-4">
              <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />
            </div>
          </div>

          {event.status !== "Open" && <GuestGrid event={event} guests={guests} me={accountId} />}
        </section>
      </div>
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
                <Link className={item} href={`/widget?event=${id}`}>Put it on your website</Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
