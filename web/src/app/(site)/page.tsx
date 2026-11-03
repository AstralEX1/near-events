"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, formatUsdc, type EventView } from "@/lib/near";
import { Cover, DateBadge, StatusPill } from "@/components/ui";

export default function Home() {
  const [list, setList] = useState<EventView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    events.list().then(setList).catch((e) => setError(String(e)));
  }, []);

  const upcoming = list?.filter((e) => e.status === "Open") ?? [];
  const past = list?.filter((e) => e.status !== "Open") ?? [];

  return (
    <div className="space-y-10">
      <section className="pt-6 pb-2">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl">
          Show up. <span className="text-accent">Split the pool.</span>
        </h1>
        <p className="mt-4 text-lg text-muted max-w-xl">
          Every guest puts down the same small USDC deposit. People who come get their deposit back plus a share of
          the no-shows. Pay from any chain. No platform fee.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/create" className="btn btn-primary">Host an event</Link>
          <a href="#upcoming" className="btn btn-ghost">Browse events</a>
          <Link href="/widget" className="btn btn-ghost">Embed on your website</Link>
        </div>
      </section>

      {error && <p className="text-warn text-sm">Could not load events: {error}</p>}
      {!list && !error && <p className="text-muted">Loading events…</p>}

      {list && (
        <>
          <EventGrid id="upcoming" title="Upcoming" items={upcoming} empty="No open events yet. Host the first one." />
          {past.length > 0 && <EventGrid title="Past" items={past} />}
        </>
      )}
    </div>
  );
}

function EventGrid({ id, title, items, empty }: { id?: string; title: string; items: EventView[]; empty?: string }) {
  return (
    <section id={id}>
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      {items.length === 0 && empty && <p className="text-muted">{empty}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((e) => (
          <Link key={e.id} href={`/e/${e.id}`} className="card p-3 flex gap-4 hover:border-accent/50 transition-colors">
            <Cover event={e} className="w-28 h-28 rounded-xl shrink-0 [&>span]:hidden" />
            <div className="min-w-0 flex-1 py-1">
              <div className="flex items-center gap-2 text-sm text-muted">
                {new Date(e.metadata.starts_at).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                <StatusPill status={e.status} />
              </div>
              <div className="font-semibold mt-1 truncate">{e.metadata.title}</div>
              <div className="text-sm text-muted truncate">{e.metadata.location}</div>
              <div className="text-sm mt-2">
                <span className="font-medium">{formatUsdc(e.deposit)} USDC</span>
                <span className="text-muted"> · {e.guest_count}/{e.capacity} going</span>
              </div>
            </div>
            <div className="hidden sm:block py-1">
              <DateBadge ms={e.metadata.starts_at} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
