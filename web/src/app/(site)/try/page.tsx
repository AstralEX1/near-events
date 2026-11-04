import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fill every slot · Near Events",
  description:
    "Turn sign-ups into show-ups. A small refundable deposit — who comes gets it back plus a share of the no-shows.",
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/** Campaign page — Feevent / reli host voice, still short. */
export default function TryPage() {
  const cta = BOT ? (
    <a href={`https://t.me/${BOT}`} className="btn btn-primary !rounded-full !px-6 !py-3 inline-flex">
      Fill your next event
    </a>
  ) : (
    <Link href="/create" className="btn btn-primary !rounded-full !px-6 !py-3 inline-flex">
      Fill your next event
    </Link>
  );

  return (
    <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6 py-16">
      <p className="text-sm font-medium text-muted tracking-wide">For organizers</p>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
        Fill every slot.
      </h1>
      <p className="text-lg text-muted">
        Turn sign-ups into show-ups. Same small deposit for every guest — who comes gets it back, plus a share of the
        no-shows. You never hold the money.
      </p>
      <div className="space-y-2">
        {cta}
        <p className="text-sm text-muted">~3 min · No fee · Cancel = full refunds</p>
      </div>
      <Link href="/" className="text-sm text-muted hover:text-text pt-4">
        ← Near Events
      </Link>
    </div>
  );
}
