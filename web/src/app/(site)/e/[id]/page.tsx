"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { Avatar, AvatarStack, Cover, DateBadge, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";

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
  const attendees = guests.filter((g) => g.status === "Attended");

  return (
    <div className="grid gap-8 md:grid-cols-[340px_1fr]">
      <aside className="space-y-6">
        <Cover event={event} className="aspect-square w-full rounded-2xl" />
        <div>
          <div className="label mb-2">Hosted by</div>
          <div className="space-y-2">
            {[event.host, ...event.cohosts].map((a, i) => (
              <div key={a} className="flex items-center gap-2 text-sm">
                <Avatar account={a} size={26} />
                <span className="truncate">{shortAccount(a)}</span>
                {i === 0 && a.includes("sputnik") && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">DAO</span>
                )}
                {i > 0 && <span className="text-xs text-muted">co-host</span>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">
            {event.guest_count} going{event.attended_count > 0 && ` · ${event.attended_count} checked in`}
          </div>
          <AvatarStack accounts={guests.map((g) => g.account_id)} max={8} />
        </div>
        {isStaff && (
          <>
            <Link href={`/e/${id}/manage`} className="btn btn-ghost w-full">Manage & check in guests</Link>
            <Link href={`/widget?event=${id}`} className="btn btn-ghost w-full">Put it on your website</Link>
          </>
        )}
      </aside>

      <section className="space-y-6">
        <div>
          <StatusPill status={event.status} />
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">{event.metadata.title}</h1>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <DateBadge ms={event.metadata.starts_at} />
            <div className="text-sm">
              <div className="font-medium">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
              <div className="text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg border border-border bg-surface flex items-center justify-center text-lg">📍</div>
            <div className="text-sm font-medium">{event.metadata.location || "Location TBA"}</div>
          </div>
        </div>

        <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />

        <PoolStats event={event} />

        {event.metadata.description && (
          <div>
            <div className="label mb-2 pb-2 border-b border-border">About event</div>
            <p className="whitespace-pre-wrap leading-relaxed">{event.metadata.description}</p>
          </div>
        )}

        {event.status === "Finalized" && attendees.length > 0 && (
          <div>
            <div className="label mb-2 pb-2 border-b border-border">Showed up and got paid</div>
            <div className="flex flex-wrap gap-2">
              {attendees.map((g) => (
                <span key={g.account_id} className="flex items-center gap-1.5 text-sm card px-2 py-1">
                  <Avatar account={g.account_id} size={20} /> {shortAccount(g.account_id)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
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
