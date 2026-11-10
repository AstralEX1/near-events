"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { events, priceLabel, type EventView } from "@/lib/near";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { Cover } from "@/components/ui";
import { EventPoster } from "@/components/EventVisual";

type Tab = "upcoming" | "past";
type Kind = "all" | "Free" | "Deposit" | "Ticket";

/** One card in the feed, from an on-chain event or a free one. */
interface Item {
  key: string;
  href: string;
  title: string;
  startsAt: number;
  past: boolean;
  kind: Exclude<Kind, "all">;
  price: string;
  going: number;
  full: boolean;
  cancelled: boolean;
  poster: ReactNode;
}

const posterClass = "aspect-square w-full rounded-xl [&>span]:hidden";

function fromChain(e: EventView): Item {
  return {
    key: `e${e.id}`, href: `/e/${e.id}`, title: e.metadata.title, startsAt: e.metadata.starts_at,
    past: e.status !== "Open", kind: e.mode === "Ticket" ? "Ticket" : "Deposit", price: priceLabel(e),
    going: e.guest_count, full: e.guest_count >= e.capacity, cancelled: e.status === "Cancelled",
    poster: <Cover event={e} className={posterClass} />,
  };
}

function fromFree(e: FreeEvent, now: number): Item {
  return {
    key: `f${e.id}`, href: `/f/${e.id}`, title: e.title, startsAt: e.starts_at,
    past: e.ends_at < now, kind: "Free", price: "Free",
    going: e.guest_count, full: e.guest_count >= e.capacity, cancelled: false,
    poster: <EventPoster title={e.title} visual={e.visual} coverUrl={e.cover_url} className={posterClass} />,
  };
}

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
      events.list(),
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
            // Phones get a compact row (small cover on the left), wider screens a cover card.
            <Link key={i.key} href={i.href} className="gc-list-card p-3 flex gap-4 items-center min-[480px]:block min-[480px]:space-y-3">
              <div className="w-24 shrink-0 min-[480px]:w-full">{i.poster}</div>
              <div className="min-w-0 px-1 pb-1 space-y-1">
                <div className="text-sm text-muted">
                  {new Date(i.startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
                <div className="font-semibold text-lg leading-snug line-clamp-2">{i.title}</div>
                <div className="flex items-center gap-2 text-sm pt-1">
                  {i.cancelled ? <span className="text-muted">Cancelled</span> : (
                    <>
                      <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-medium">{i.price}</span>
                      <span className="text-muted">{!i.past && i.full ? "Full" : `${i.going} ${i.past ? "went" : "going"}`}</span>
                    </>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
