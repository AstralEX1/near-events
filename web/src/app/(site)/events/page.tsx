"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events } from "@/lib/near";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { EventCard, fromChain, fromFree, type Item } from "@/components/EventCard";

type Tab = "upcoming" | "past";
type Kind = "all" | Item["kind"];

/** Public events feed, laid out like Luma Discover and BaliSquad: search, filters, a grid of cover cards. */
export default function Events() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const now = Date.now();
    // Either source may fail on its own; show what loaded.
    Promise.allSettled([
      events.listPublic(),
      fetch("/api/free-events", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject(new Error("Free events unavailable"))),
    ]).then(([chain, free]) => {
      const list = [
        ...(chain.status === "fulfilled" ? chain.value.map(fromChain) : []),
        ...(free.status === "fulfilled" ? (free.value.events as FreeEvent[]).map((e) => fromFree(e, now)) : []),
      ];
      if (chain.status === "rejected" && free.status === "rejected") setError(String(chain.reason));
      setItems(list);
    });
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (items ?? [])
    .filter((i) => i.past === (tab === "past") && (kind === "all" || i.kind === kind) && (!q || i.title.toLowerCase().includes(q)))
    .sort((a, b) => (tab === "upcoming" ? a.startsAt - b.startsAt : b.startsAt - a.startsAt));

  const pill = (active: boolean) => `px-3.5 py-1.5 rounded-full text-sm border ${active ? "bg-text text-bg border-text" : "border-border text-muted hover:text-text"}`;

  return (
    <div className="space-y-6 pt-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="gc-page-title">Discover events</h1>
          <p className="text-lg text-muted">Find your next reason to get together.</p>
        </div>
        <Link href="/create" className="btn btn-primary">Create event</Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-full p-1 bg-border/40" role="group" aria-label="When">
          {(["upcoming", "past"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm ${tab === t ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}>
              {t === "upcoming" ? "Upcoming" : "Past"}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="lu-field flex-1 min-w-48 px-3 py-2 text-sm"
          placeholder="Search events"
          aria-label="Search events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="How guests join">
        {([["all", "All"], ["Free", "Free"], ["Deposit", "Deposit"], ["Ticket", "Ticket"]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={pill(kind === k)}>{label}</button>
        ))}
      </div>

      {error && <p className="text-warn text-sm">Could not load events: {error}</p>}
      {!items && !error && <p className="text-muted">Loading events…</p>}
      {items && shown.length === 0 && (
        <p className="text-muted">{q || kind !== "all" ? "Nothing matches. Try another search or filter." : tab === "upcoming" ? "No upcoming events yet. Host the first one." : "No past events yet."}</p>
      )}
      {shown.length > 0 && (
        <div className="grid gap-5 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <EventCard key={i.key} item={i} />
          ))}
        </div>
      )}
    </div>
  );
}
