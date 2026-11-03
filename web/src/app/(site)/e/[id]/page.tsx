"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Avatar, Cover, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";
import { GuestGrid } from "@/components/EventParts";
import { SponsorButton } from "@/components/Sponsor";
import { EVENTS_CONTRACT, EXPLORER_URL } from "@/lib/config";

/**
 * Kept minimal, like Kickback: the event on the left, one card on the right
 * that changes with your state (register → going → withdraw). Extras live in "…".
 */
export default function EventPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [guests, setGuests] = useState<GuestView[]>([]);
  const [sponsoring, setSponsoring] = useState(false);

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

  return (
    <div className="grid gap-8 lg:gap-12 md:grid-cols-[1.15fr_1fr] items-start">
      <section className="space-y-5 min-w-0">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            {formatWhen(event.metadata.starts_at, event.metadata.ends_at)}
            {event.status !== "Open" && <StatusPill status={event.status} />}
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-2">{event.metadata.title}</h1>
        </div>

        <Cover event={event} className="aspect-[16/10] w-full rounded-2xl" />

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <Avatar account={event.host} size={22} />
            <span className="text-muted">Hosted by</span>
            <Link href={`/u/${encodeURIComponent(event.host)}`} className="font-medium hover:text-accent truncate">
              {shortAccount(event.host)}
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-[22px] text-center">📍</span>
            <span>{event.metadata.location || "Location TBA"}</span>
          </div>
        </div>

        {event.metadata.description && <p className="whitespace-pre-wrap leading-relaxed">{event.metadata.description}</p>}
      </section>

      <section className="space-y-5 md:sticky md:top-20">
        <div className="flex items-center gap-2 text-sm">
          <span>
            <b>{formatUsdc(event.deposit)} USDC</b> deposit
            <span className="text-muted"> · pool {formatUsdc(event.total_pool)} USDC</span>
          </span>
          <MoreMenu
            id={id}
            isStaff={isStaff}
            canSponsor={event.status === "Open"}
            onSponsor={() => setSponsoring(true)}
          />
        </div>
        {sponsoring && <SponsorButton event={event} onDone={load} startOpen onClose={() => setSponsoring(false)} />}
        <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />
        <GuestGrid event={event} guests={guests} me={accountId} />
        {isStaff && event.status === "Open" && (
          <Link href={`/e/${id}/manage`} className="block text-sm text-accent">Check in guests →</Link>
        )}
      </section>
    </div>
  );
}

/** Everything secondary: share link, contract, sponsoring, host tools. */
function MoreMenu({ id, isStaff, canSponsor, onSponsor }: { id: number; isStaff: boolean; canSponsor: boolean; onSponsor: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const item = "block w-full text-left px-3 py-2 rounded-lg hover:bg-border/50";
  return (
    <div className="relative ml-auto">
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
            {canSponsor && (
              <button
                className={item}
                onClick={() => {
                  setOpen(false);
                  onSponsor();
                }}
              >
                Sponsor this event
              </button>
            )}
            <a className={item} href={`${EXPLORER_URL}/address/${EVENTS_CONTRACT}`} target="_blank" rel="noopener">
              View contract ↗
            </a>
            {isStaff && (
              <>
                <div className="border-t border-border my-1" />
                <Link className={item} href={`/e/${id}/manage`}>Check in guests</Link>
                <Link className={item} href={`/widget?event=${id}`}>Put it on your website</Link>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
