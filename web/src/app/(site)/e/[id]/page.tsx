"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Avatar, Cover, DateBadge, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";
import { GuestGrid } from "@/components/EventParts";
import { SponsorButton } from "@/components/Sponsor";
import { EVENTS_CONTRACT, EXPLORER_URL } from "@/lib/config";

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

  // Kickback's layout: the event on the left, joining and the guest list on the right.
  return (
    <div className="grid gap-8 lg:gap-12 md:grid-cols-[1.1fr_1fr] items-start">
      <section className="space-y-6 min-w-0">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            <span>{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</span>
            <StatusPill status={event.status} />
          </div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-2">{event.metadata.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3">
            <ShareLink id={id} />
            <a
              className="mt-2 text-xs text-muted hover:text-text"
              href={`${EXPLORER_URL}/address/${EVENTS_CONTRACT}`}
              target="_blank"
              rel="noopener"
              title="Every deposit, check-in and payout is public on-chain"
            >
              Contract: {EVENTS_CONTRACT} ↗
            </a>
          </div>
        </div>

        <Cover event={event} className="aspect-[16/10] w-full rounded-2xl" />

        <div className="space-y-3">
          <Row icon={<Avatar account={event.host} size={28} />}>
            Hosted by{" "}
            <Link href={`/u/${encodeURIComponent(event.host)}`} className="font-medium hover:text-accent">
              {shortAccount(event.host)}
            </Link>
            {event.host.includes("sputnik") && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">DAO</span>
            )}
            {event.cohosts.length > 0 && (
              <span className="text-muted"> · door: {event.cohosts.map(shortAccount).join(", ")}</span>
            )}
          </Row>
          <Row icon={<DateBadge ms={event.metadata.starts_at} />}>
            <div className="font-medium">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
            <div className="text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
          </Row>
          <Row icon={<IconTile>📍</IconTile>}>
            <span className="font-medium">{event.metadata.location || "Location TBA"}</span>
          </Row>
          <Row icon={<IconTile>💰</IconTile>}>
            Total pool <b className="font-medium">{formatUsdc(event.total_pool)} USDC</b>{" "}
            <span
              className="inline-flex w-4 h-4 rounded-full border border-border text-[10px] text-muted items-center justify-center cursor-help align-middle"
              title={`${event.guest_count} deposits × ${formatUsdc(event.deposit)} USDC + ${formatUsdc(event.bonus_pool)} USDC sponsor bonus. At the end it is split equally between everyone checked in, so no-shows’ deposits go to those who came.`}
            >
              i
            </span>
            <div>
              <SponsorButton event={event} onDone={load} />
            </div>
          </Row>
        </div>

        <PoolStats event={event} />

        {event.metadata.description && (
          <div>
            <div className="label mb-2 pb-2 border-b border-border">About event</div>
            <p className="whitespace-pre-wrap leading-relaxed">{event.metadata.description}</p>
          </div>
        )}

        {isStaff && (
          <div className="grid sm:grid-cols-2 gap-2">
            <Link href={`/e/${id}/manage`} className="btn btn-ghost">Manage & check in guests</Link>
            <Link href={`/widget?event=${id}`} className="btn btn-ghost">Put it on your website</Link>
          </div>
        )}
      </section>

      <section className="space-y-6 md:sticky md:top-20">
        <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />
        <p className="text-sm">
          {event.status === "Open"
            ? event.guest_count === 0
              ? "Be the first to join."
              : `Join the event! ${event.guest_count} ${event.guest_count === 1 ? "person is" : "people are"} going.`
            : event.status === "Finalized"
              ? `This event is over. ${event.attended_count} out of ${event.guest_count} people came.`
              : "This event was cancelled."}
        </p>
        <GuestGrid event={event} guests={guests} me={accountId} />
      </section>
    </div>
  );
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-11 flex justify-center shrink-0">{icon}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function IconTile({ children }: { children: React.ReactNode }) {
  return <div className="w-11 h-11 rounded-lg border border-border bg-surface flex items-center justify-center text-lg">{children}</div>;
}

/** The event's own link, one click to copy (Kickback shows it under the title). */
function ShareLink({ id }: { id: number }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(`${window.location.origin}/e/${id}`), [id]);
  return (
    <button
      className="mt-2 text-sm text-accent hover:underline underline-offset-2 truncate max-w-full"
      onClick={() =>
        navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? "Link copied ✓" : url}
    </button>
  );
}

function PoolStats({ event }: { event: EventView }) {
  const stats = [
    { label: "Deposit", value: `${formatUsdc(event.deposit)} USDC` },
    { label: "Going", value: `${event.guest_count} / ${event.capacity}` },
    { label: "Pool", value: `${formatUsdc(event.total_pool)} USDC` },
    event.status === "Finalized"
      ? { label: "Paid per attendee", value: `${formatUsdc(event.payout_per_attendee)} USDC` }
      : { label: "Sponsor bonus", value: `${formatUsdc(event.bonus_pool)} USDC` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface p-4">
          <div className="text-xs text-muted">{s.label}</div>
          <div className="font-semibold mt-1">{s.value}</div>
        </div>
      ))}
    </div>
  );
}
