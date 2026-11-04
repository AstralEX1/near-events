"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, type EventView, formatUsdc } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = BOT ? `https://t.me/${BOT}` : "/create";

/**
 * Luma / Partiful style: first viewport is almost only headline + one line + CTA.
 * Long pitch lives on /guide. Campaign copy on /try.
 */
export default function Landing() {
  const [open, setOpen] = useState<EventView[]>([]);

  useEffect(() => {
    events
      .list()
      .then((list) => setOpen(list.filter((e) => e.status === "Open").slice(0, 4)))
      .catch(() => {});
  }, []);

  const create = BOT ? (
    <a href={CREATE} className="btn btn-primary !rounded-full !px-6 !py-3">
      Create Your First Event
    </a>
  ) : (
    <Link href="/create" className="btn btn-primary !rounded-full !px-6 !py-3">
      Create Your First Event
    </Link>
  );

  return (
    <div className="pb-16">
      {/* First viewport — Luma-simple */}
      <section className="relative min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-2">
        <FloatingHints />
        <div className="relative z-[1] space-y-6 max-w-2xl mx-auto">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
            They clicked Going.
            <br />
            Half won’t come.
          </h1>
          <p className="text-lg sm:text-xl text-muted max-w-md mx-auto">
            A small refundable deposit. Who shows up gets it back — plus a share of the no-shows.
          </p>
          <div className="flex flex-col items-center gap-3 pt-1">
            {create}
            <Link href="/events" className="text-sm text-muted hover:text-text">
              Discover events →
            </Link>
          </div>
        </div>
      </section>

      {/* Quiet proof — one line, not a deck */}
      <p className="text-center text-sm text-muted pb-16">
        Free RSVP ~50% no-show · with a deposit ~10% · $0 fee
      </p>

      {open.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-sm font-medium text-muted text-center tracking-wide uppercase">Open now</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {open.map((e) => (
              <Link
                key={e.id}
                href={`/e/${e.id}`}
                className="card p-4 text-left hover:border-accent/40 transition-colors"
              >
                <div className="font-semibold truncate">{e.metadata.title}</div>
                <div className="text-sm text-muted mt-1">
                  {formatUsdc(e.deposit)} USDC · {e.guest_count}/{e.capacity} going
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Soft atmosphere cards — show the idea without a feature list (Luma floating tiles). */
function FloatingHints() {
  const tiles = [
    { t: "Going", d: "costs $0", className: "left-[4%] top-[12%] -rotate-6 hidden sm:block" },
    { t: "Deposit", d: "$5 back if you come", className: "right-[6%] top-[18%] rotate-3 hidden sm:block" },
    { t: "No-show", d: "pool → attendees", className: "left-[8%] bottom-[18%] rotate-2 hidden md:block" },
    { t: "You", d: "never hold the money", className: "right-[5%] bottom-[14%] -rotate-3 hidden md:block" },
  ];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {tiles.map((x) => (
        <div
          key={x.t}
          className={`absolute ${x.className} rounded-2xl border border-border bg-surface/90 shadow-sm px-4 py-3 text-left`}
        >
          <div className="text-sm font-semibold">{x.t}</div>
          <div className="text-xs text-muted">{x.d}</div>
        </div>
      ))}
    </div>
  );
}
