import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Try Near Events",
  description: "A small refundable deposit. Who shows up gets it back — plus a share of the no-shows.",
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/** Short campaign page — still minimal, a touch more than Luma home for ads. */
export default function TryPage() {
  const cta = BOT ? (
    <a href={`https://t.me/${BOT}`} className="btn btn-primary !rounded-full !px-6 !py-3 inline-flex">
      Create Your First Event
    </a>
  ) : (
    <Link href="/create" className="btn btn-primary !rounded-full !px-6 !py-3 inline-flex">
      Create Your First Event
    </Link>
  );

  return (
    <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center max-w-xl mx-auto space-y-6 py-16">
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
        Going costs nothing.
        <br />
        That’s the problem.
      </h1>
      <p className="text-lg text-muted">
        Same small deposit for every guest. Who comes gets it back — plus a share of the no-shows. Event stays free.
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
