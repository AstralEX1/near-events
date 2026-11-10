"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { priceLabel, type EventView } from "@/lib/near";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { Cover } from "./ui";
import { EventPoster } from "./EventVisual";

/** One event card, from an on-chain event or a free one. Used by /events and My events. */
export interface Item {
  key: string;
  href: string;
  title: string;
  startsAt: number;
  past: boolean;
  kind: "Free" | "Deposit" | "Ticket";
  price: string;
  going: number;
  full: boolean;
  cancelled: boolean;
  poster: ReactNode;
}

const posterClass = "aspect-square w-full rounded-xl [&>span]:hidden";

export function fromChain(e: EventView): Item {
  return {
    key: `e${e.id}`, href: `/e/${e.id}`, title: e.metadata.title, startsAt: e.metadata.starts_at,
    past: e.status !== "Open", kind: e.mode === "Ticket" ? "Ticket" : "Deposit", price: priceLabel(e),
    going: e.guest_count, full: e.guest_count >= e.capacity, cancelled: e.status === "Cancelled",
    poster: <Cover event={e} className={posterClass} />,
  };
}

export function fromFree(e: FreeEvent, now: number): Item {
  return {
    key: `f${e.id}`, href: `/f/${e.id}`, title: e.title, startsAt: e.starts_at,
    past: e.ends_at < now, kind: "Free", price: "Free",
    going: e.guest_count, full: e.guest_count >= e.capacity, cancelled: false,
    poster: <EventPoster title={e.title} visual={e.visual} coverUrl={e.cover_url} className={posterClass} />,
  };
}

export function EventCard({ item: i, tag }: { item: Item; tag?: string }) {
  return (
    // Phones get a compact row (small cover on the left), wider screens a cover card.
    <Link href={i.href} className="gc-list-card p-3 flex gap-4 items-center min-[480px]:block min-[480px]:space-y-3">
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
          {tag && <span className="ml-auto text-xs font-medium text-muted">{tag}</span>}
        </div>
      </div>
    </Link>
  );
}
