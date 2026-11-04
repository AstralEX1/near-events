"use client";

import Link from "next/link";

/** Two products: Create event · Integrate widget (Luma or your site). */
export default function Landing() {
  return (
    <section className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-4 py-16">
      <div className="max-w-2xl mx-auto space-y-10 w-full">
        <div className="space-y-5">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
            Turn sign-ups
            <br />
            into show-ups.
          </h1>
          <p className="text-lg sm:text-xl text-muted max-w-md mx-auto">
            A small refundable deposit. Who comes gets it back — plus a share of the no-shows.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-left">
          <Link
            href="/create"
            className="rounded-2xl border border-border bg-surface p-5 hover:border-accent/40 transition-colors space-y-2"
          >
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">Product 1</div>
            <div className="text-lg font-semibold">Create event</div>
            <p className="text-sm text-muted leading-snug">
              Your page on Near Events — deposit, guests, door check-in, payout.
            </p>
          </Link>
          <Link
            href="/widget"
            className="rounded-2xl border border-border bg-surface p-5 hover:border-accent/40 transition-colors space-y-2"
          >
            <div className="text-xs font-semibold text-muted uppercase tracking-wide">Product 2</div>
            <div className="text-lg font-semibold">Integrate widget</div>
            <p className="text-sm text-muted leading-snug">
              Keep Luma or your site. Add our deposit — on Luma or on your landing.
            </p>
          </Link>
        </div>

        <a
          href="https://near.org/intents"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs text-muted hover:text-text"
        >
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#00EC97] text-black text-[10px] font-bold">
            N
          </span>
          Powered by NEAR Intents
        </a>
      </div>
    </section>
  );
}
