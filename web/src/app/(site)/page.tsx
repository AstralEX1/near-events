"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, type EventView, formatUsdc } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = BOT ? `https://t.me/${BOT}` : "/create";

/**
 * Organizer ICP (Feevent / reli), Luma-short form:
 * big host outcome → one mechanism line → one CTA. Not a guest discovery page.
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
      Fill your next event
    </a>
  ) : (
    <Link href="/create" className="btn btn-primary !rounded-full !px-6 !py-3">
      Fill your next event
    </Link>
  );

  return (
    <div className="pb-16">
      <section className="relative min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-2">
        <FloatingHints />
        <div className="relative z-[1] space-y-6 max-w-2xl mx-auto">
          <p className="text-sm font-medium text-muted tracking-wide">For organizers</p>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
            Turn sign-ups
            <br />
            into show-ups.
          </h1>
          <p className="text-lg sm:text-xl text-muted max-w-lg mx-auto">
            A small refundable deposit. Who comes gets it back — plus a share of the no-shows. Communities that actually
            show up.
          </p>
          <div className="flex flex-col items-center gap-3 pt-1">
            {create}
            <Link href="/guide" className="text-sm text-muted hover:text-text">
              How it works →
            </Link>
          </div>
        </div>
      </section>

      <p className="text-center text-sm text-muted pb-16">
        Free RSVP ~50% no-show · with a deposit ~10% · $0 fee · you never hold the money
      </p>

      {open.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-sm font-medium text-muted text-center tracking-wide uppercase">Live events</h2>
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

function FloatingHints() {
  const tiles = [
    { t: "Sign-ups", d: "easy to fake", className: "left-[4%] top-[12%] -rotate-6 hidden sm:block" },
    { t: "Show-ups", d: "what you need", className: "right-[6%] top-[18%] rotate-3 hidden sm:block" },
    { t: "Deposit", d: "back if they come", className: "left-[8%] bottom-[18%] rotate-2 hidden md:block" },
    { t: "No-shows", d: "split the pool", className: "right-[5%] bottom-[14%] -rotate-3 hidden md:block" },
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
