import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fill every slot · Near Events",
  description:
    "Turn sign-ups into show-ups. A small refundable deposit — who comes gets it back plus a share of the no-shows.",
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/** Same short voice as home — no extra chrome. */
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
    <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-8 py-16 px-4">
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">Fill every slot.</h1>
      <p className="text-lg text-muted">
        Same small deposit for every guest. Who comes gets it back — plus a share of the no-shows.
      </p>
      <div className="flex flex-col items-center gap-3">
        {cta}
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
  );
}
