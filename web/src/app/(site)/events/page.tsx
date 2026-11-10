"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events } from "@/lib/near";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { EventCard, fromChain, fromFree, type Item } from "@/components/EventCard";
import { Icon } from "@/components/EventSections";

const CALENDAR_PLUS = ["M8 2v4", "M16 2v4", "M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8", "M3 10h18", "M16 19h6", "M19 16v6"];

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

  const invite = !!items && tab === "upcoming" && !q && kind === "all" && shown.length < 3;
  const pill = (active: boolean) => `px-3.5 py-1.5 rounded-full text-sm border ${active ? "bg-text text-bg border-text" : "border-border text-muted hover:text-text"}`;

  return (
    <div className="space-y-6 pt-4 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="gc-page-title">Discover events</h1>
          <p className="text-lg text-muted">Find your next reason to get together.</p>
        </div>
        <Link href="/create" className="btn btn-primary">Create Event</Link>
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
      {!items && !error && (
        <div className="grid gap-5 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading events">
          {[0, 1, 2].map((n) => (
            <div key={n} className="gc-list-card p-3 flex gap-4 items-center min-[480px]:block min-[480px]:space-y-3 animate-pulse">
              <div className="w-24 shrink-0 aspect-square rounded-xl bg-text/5 min-[480px]:w-full" />
              <div className="flex-1 space-y-2 px-1 pb-1">
                <div className="h-3 w-24 rounded bg-text/5" />
                <div className="h-4 w-3/4 rounded bg-text/10" />
                <div className="h-3 w-20 rounded bg-text/5" />
              </div>
            </div>
          ))}
        </div>
      )}
      {items && shown.length === 0 && !invite && (
        <p className="text-muted">{q || kind !== "all" ? "Nothing matches. Try another search or filter." : "No past events yet."}</p>
      )}
      {(shown.length > 0 || invite) && (
        <div className="grid gap-5 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {shown.map((i) => (
            <EventCard key={i.key} item={i} />
          ))}
          {/* A sparse feed reads as dead; fill the row with a way in instead. */}
          {invite && (
            <Link href="/create" className="gc-list-card gc-invite-card">
              <span className="gc-reg-icon"><Icon paths={CALENDAR_PLUS} size={20} /></span>
              <span className="font-semibold">Host Your Own</span>
              <span className="text-sm text-muted">Free, deposit or ticket.</span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
