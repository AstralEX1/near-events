"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, formatUsdc, type EventView } from "@/lib/near";
import { Cover } from "@/components/ui";

type Tab = "upcoming" | "past";

export default function Home() {
  const [list, setList] = useState<EventView[] | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    events.list().then(setList).catch((e) => setError(String(e)));
  }, []);

  const all = list ?? [];
  const tabs: [Tab, string, EventView[], string][] = [
    ["upcoming", "Upcoming", all.filter((e) => e.status === "Open"), "No open events yet. Host the first one."],
    ["past", "Past", all.filter((e) => e.status !== "Open"), "No past events yet."],
  ];
  const current = tabs.find((t) => t[0] === tab) ?? tabs[0];

  return (
    <div className="space-y-7 pt-4">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Show up. Split the pool.</h1>
        <p className="text-lg text-muted">Put down a small deposit. Come, and get it back plus a share of the no-shows.</p>
      </div>
      <div className="flex gap-6 border-b border-border" role="group" aria-label="Event lists">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`h-11 -mb-px border-b-2 ${tab === k ? "border-text font-semibold" : "border-transparent text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="text-warn text-sm">Could not load events: {error}</p>}
      {!list && !error && <p className="text-muted">Loading events…</p>}
      {list && <EventGrid items={current[2]} empty={current[3]} />}
    </div>
  );
}

function EventGrid({ items, empty }: { items: EventView[]; empty?: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  return (
    <div className="grid gap-x-6 gap-y-8 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
      {items.map((e) => (
        <Link key={e.id} href={`/e/${e.id}`} className="flex flex-col gap-2 group">
          <Cover event={e} className="aspect-[16/10] w-full rounded-2xl [&>span]:hidden group-hover:opacity-90 transition-opacity" />
          <span className="text-sm text-muted">
            {new Date(e.metadata.starts_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            {e.metadata.location && ` · ${e.metadata.location}`}
          </span>
          <span className="font-semibold text-[17px]">{e.metadata.title}</span>
          <span className="text-sm text-muted">
            {e.status === "Finalized"
              ? `${e.attended_count} of ${e.guest_count} came · ${formatUsdc(e.payout_per_attendee)} USDC each`
              : `${formatUsdc(e.deposit)} USDC · ${e.guest_count >= e.capacity ? "full" : `${e.guest_count} going`}`}
          </span>
        </Link>
      ))}
    </div>
  );
}
