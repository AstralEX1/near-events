import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try Near Events",
  description:
    "Free RSVPs no-show. Add a refundable deposit so people who show up get it back plus a share of the no-shows. No fee.",
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/**
 * Short campaign landing for ads / X / hackathon traffic.
 * Unbounce: one goal, <350 words, specific CTA, no nav clutter (header trims on /try).
 */
export default function TryPage() {
  const cta = BOT ? (
    <a href={`https://t.me/${BOT}`} className="btn btn-accent !py-3 !px-5 inline-flex">
      Create your first deposit event
    </a>
  ) : (
    <Link href="/create" className="btn btn-accent !py-3 !px-5 inline-flex">
      Create your first deposit event
    </Link>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-10 pt-8 pb-16">
      <section className="space-y-5 text-center">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08]">
          Clicking “Going” costs nothing. That’s why half don’t come.
        </h1>
        <p className="text-lg text-muted">
          Same small refundable deposit for every guest. Who shows up gets it back plus a share of the no-shows. The
          event stays free.
        </p>
        <div className="space-y-2">
          <div className="flex justify-center">{cta}</div>
          <p className="text-sm text-muted">
            ~3 min · No fee · Cancel = everyone refunded
          </p>
        </div>
      </section>

      <p className="text-center text-lg font-semibold tracking-tight">
        Free RSVP ~<span className="text-warn">50%</span> no-show → deposit ~<span className="text-good">10%</span>
      </p>

      <ol className="space-y-4 text-left">
        {[
          ["Guest deposits", "A few dollars. Google sign-in or almost any chain."],
          ["You check them in", "QR or Telegram. Attendance is on-chain."],
          ["Who came splits the pool", "You never hold the money. We take $0."],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="w-7 h-7 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center shrink-0 text-sm">
              {i + 1}
            </span>
            <div>
              <div className="font-semibold">{t}</div>
              <p className="text-sm text-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="text-center space-y-3 pt-2">
        <div className="flex justify-center">{cta}</div>
        <p className="text-sm text-muted">
          Want the full story?{" "}
          <Link href="/" className="text-accent hover:underline">
            Near Events home
          </Link>
        </p>
      </div>
    </div>
  );
}
