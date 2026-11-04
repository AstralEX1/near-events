"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, type EventView, formatUsdc } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = BOT ? `https://t.me/${BOT}` : "/create";
const INTENTS_URL = "https://near.org/intents";

/**
 * Organizer ICP (Feevent / reli) + Luma-short form.
 * Visual shows sign-ups → show-ups; NEAR Intents as the rail.
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
      <section className="relative min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-2 py-10">
        <div className="relative z-[1] w-full max-w-3xl mx-auto space-y-8">
          <div className="space-y-5">
            <p className="text-sm font-medium text-muted tracking-wide">For organizers</p>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
              Turn sign-ups
              <br />
              into show-ups.
            </h1>
            <p className="text-lg sm:text-xl text-muted max-w-lg mx-auto">
              A small refundable deposit. Who comes gets it back — plus a share of the no-shows.
            </p>
          </div>

          <ShowUpVisual />

          <div className="flex flex-col items-center gap-3">
            {create}
            <Link href="/guide" className="text-sm text-muted hover:text-text">
              How it works →
            </Link>
            <PoweredByIntents />
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

/** Before / after: empty Going list → filled room with deposit back. */
function ShowUpVisual() {
  const ghosts = ["Alex", "Sam", "Jo", "Riley", "Kai", "Morgan", "Lee", "Sky"];
  const shows = ghosts.slice(0, 7);

  return (
    <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-4 items-stretch text-left max-w-2xl mx-auto">
      <div className="rounded-3xl border border-border bg-border/20 p-4 sm:p-5 opacity-80">
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Sign-ups</div>
        <ul className="space-y-2">
          {ghosts.map((name, i) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span className="w-6 h-6 rounded-full bg-border shrink-0" />
              <span className={i >= 4 ? "text-muted line-through decoration-warn/60" : "text-muted"}>
                {name}
              </span>
              <span className="ml-auto text-[11px] text-muted">Going</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-3 border-t border-border text-xs text-warn font-medium">~Half never show</div>
      </div>

      <div className="flex sm:flex-col items-center justify-center gap-2 py-1">
        <div className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold shadow-sm whitespace-nowrap">
          $5 deposit
        </div>
        <span className="text-muted text-lg sm:rotate-0 rotate-90" aria-hidden>
          →
        </span>
      </div>

      <div className="rounded-3xl border border-border bg-surface p-4 sm:p-5 shadow-sm">
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-3">Show-ups</div>
        <ul className="space-y-2">
          {shows.map((name) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span className="w-6 h-6 rounded-full bg-good/20 text-good flex items-center justify-center text-[11px] font-bold shrink-0">
                ✓
              </span>
              <span className="font-medium">{name}</span>
              <span className="ml-auto text-[11px] text-good">+$5 + share</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 pt-3 border-t border-border text-xs text-good font-medium">Seats filled · pool split</div>
      </div>
    </div>
  );
}

function PoweredByIntents() {
  return (
    <a
      href={INTENTS_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-xs text-muted hover:text-text pt-2"
    >
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#00EC97] text-black text-[10px] font-bold">
        N
      </span>
      Powered by NEAR Intents
    </a>
  );
}
