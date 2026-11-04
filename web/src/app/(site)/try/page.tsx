import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fill every slot · Near Events",
  description:
    "Turn sign-ups into show-ups. A small refundable deposit — who comes gets it back plus a share of the no-shows.",
};

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/** Campaign page — host voice + tiny visual + Intents. */
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
    <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-7 py-16 px-2">
      <p className="text-sm font-medium text-muted tracking-wide">For organizers</p>
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">Fill every slot.</h1>
      <p className="text-lg text-muted">
        Turn sign-ups into show-ups. Same small deposit — who comes gets it back, plus a share of the no-shows.
      </p>

      <div className="w-full rounded-2xl border border-border bg-surface shadow-sm overflow-hidden text-left">
        <div className="px-3 py-2 border-b border-border text-[11px] font-semibold text-muted">
          Register → door QR → withdraw
        </div>
        <div className="p-4 space-y-3">
          <div className="font-semibold text-sm">NEAR Builders Breakfast</div>
          <div className="h-10 rounded-xl bg-accent text-white text-sm font-bold flex items-center justify-center">
            Register · 10 USDC
          </div>
          <p className="text-xs text-muted leading-snug">
            Same deposit for every guest. Show up → get it back plus a share of the no-shows. Via NEAR Intents.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {cta}
        <p className="text-sm text-muted">~3 min · No fee · Cancel = full refunds</p>
        <a
          href="https://near.org/intents"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs text-muted hover:text-text pt-1"
        >
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#00EC97] text-black text-[10px] font-bold">
            N
          </span>
          Powered by NEAR Intents
        </a>
      </div>
      <Link href="/" className="text-sm text-muted hover:text-text pt-2">
        ← Near Events
      </Link>
    </div>
  );
}
