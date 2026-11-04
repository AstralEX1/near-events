"use client";

import Link from "next/link";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = BOT ? `https://t.me/${BOT}` : "/create";

/** Step 1: Feevent-short hero only. Product frames / live events come later. */
export default function Landing() {
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
    <section className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-4 py-16">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
          Turn sign-ups
          <br />
          into show-ups.
        </h1>
        <p className="text-lg sm:text-xl text-muted max-w-md mx-auto">
          A small refundable deposit. Who comes gets it back — plus a share of the no-shows.
        </p>
        <div className="flex flex-col items-center gap-3">
          {create}
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
      </div>
    </section>
  );
}
