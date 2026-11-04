"use client";

import { useEffect, useState } from "react";
import { events, type EventView } from "@/lib/near";
import { Timeline } from "@/components/Timeline";

type Tab = "upcoming" | "past";

export default function Events() {
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
    <div className="space-y-7 pt-4 max-w-4xl mx-auto">
      <div className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Events</h1>
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
      {list && (
        <Timeline
          items={[...current[2]].sort((a, b) =>
            current[0] === "upcoming" ? a.metadata.starts_at - b.metadata.starts_at : b.metadata.starts_at - a.metadata.starts_at,
          )}
          empty={current[3]}
        />
      )}
    </div>
  );
}
