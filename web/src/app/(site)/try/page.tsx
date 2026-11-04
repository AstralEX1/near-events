import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fill every slot · Near Events",
  description:
    "Turn sign-ups into show-ups. Create an event or embed the deposit widget on your site.",
};

/** Same two products as home — short campaign page. */
export default function TryPage() {
  return (
    <div className="min-h-[calc(100vh-10rem)] flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-8 py-16 px-4">
      <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">Fill every slot.</h1>
      <p className="text-lg text-muted">
        Same small deposit for every guest. Who comes gets it back — plus a share of the no-shows.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
        <Link href="/create" className="rounded-2xl border border-border bg-surface p-4 hover:border-accent/40 transition-colors">
          <div className="font-semibold">Create event</div>
          <p className="text-sm text-muted mt-1">Host on Near Events</p>
        </Link>
        <Link href="/widget" className="rounded-2xl border border-border bg-surface p-4 hover:border-accent/40 transition-colors">
          <div className="font-semibold">Integrate widget</div>
          <p className="text-sm text-muted mt-1">Embed on your landing</p>
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
  );
}
