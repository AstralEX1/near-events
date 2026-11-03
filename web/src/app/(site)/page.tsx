"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, formatUsdc, type EventView } from "@/lib/near";
import { Cover, DateBadge, StatusPill } from "@/components/ui";
import { useWallet } from "@/lib/wallet";
import { spotsLine } from "@/components/EventParts";

type Tab = "upcoming" | "past" | "hosting" | "going";

export default function Home() {
  const { accountId } = useWallet();
  const [list, setList] = useState<EventView[] | null>(null);
  const [myIds, setMyIds] = useState<number[]>([]);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    events.list().then(setList).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    if (accountId) events.guestEvents(accountId).then(setMyIds).catch(() => {});
    else setMyIds([]);
  }, [accountId]);

  const all = list ?? [];
  const tabs: [Tab, string, EventView[], string][] = [
    ["upcoming", "Upcoming", all.filter((e) => e.status === "Open"), "No open events yet. Host the first one."],
    ["past", "Past", all.filter((e) => e.status !== "Open"), "No past events yet."],
    ...(accountId
      ? ([
          ["going", "Going", all.filter((e) => myIds.includes(e.id)), "You haven’t registered for anything yet."],
          ["hosting", "Hosting", all.filter((e) => e.host === accountId || e.cohosts.includes(accountId)), "You aren’t hosting any events."],
        ] as [Tab, string, EventView[], string][])
      : []),
  ];
  const current = tabs.find((t) => t[0] === tab) ?? tabs[0];

  return (
    <div className="space-y-12">
      <section className="pt-6 pb-2">
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl">
          Show up. <span className="text-accent">Split the pool.</span>
        </h1>
        <p className="mt-4 text-lg text-muted max-w-xl">
          Free events lose half their guests. Here every guest puts down the same small USDC deposit. People who come get
          it back plus a share of the no-shows. Pay from any chain. No platform fee.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/create" className="btn btn-primary">Host an event</Link>
          <a href="#events" className="btn btn-ghost">Browse events</a>
          <Link href="/widget" className="btn btn-ghost">Embed on your website</Link>
        </div>
      </section>

      <HowItWorks />

      <section id="events" className="space-y-4 scroll-mt-20">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map(([k, label, items]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3.5 py-1.5 rounded-full text-sm border ${tab === k ? "bg-text text-bg border-text" : "border-border text-muted hover:text-text"}`}
            >
              {label}
              {list && <span className="ml-1.5 opacity-60">{items.length}</span>}
            </button>
          ))}
        </div>
        {error && <p className="text-warn text-sm">Could not load events: {error}</p>}
        {!list && !error && <p className="text-muted">Loading events…</p>}
        {list && <EventGrid items={current[2]} empty={current[3]} />}
      </section>

      <section className="card p-6 sm:p-8 grid gap-6 sm:grid-cols-[1fr_auto] items-center">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Run a community, coworking or club?</h2>
          <p className="text-muted mt-2 max-w-xl">
            Put registration with deposits on your own website in two lines of code, or send one prompt to your AI agent
            and let it do it.
          </p>
        </div>
        <Link href="/widget" className="btn btn-accent">Get the widget</Link>
      </section>
    </div>
  );
}

/** Kickback's landing told the story in three pictures; ours in three cards. */
function HowItWorks() {
  const steps = [
    ["🎟️", "Register with a deposit", "Sign in with Google, email or any wallet and put down the event’s deposit, from any chain or token."],
    ["🚪", "Show up and get checked in", "The host scans your QR code at the door. That’s what makes you eligible for the payout."],
    ["💸", "Split the pool", "After the event, everyone who came gets their deposit back plus an equal share of the no-shows’ deposits."],
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {steps.map(([icon, title, text], i) => (
        <div key={title} className="card p-5">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{icon}</span>
            <span className="text-xs font-semibold text-accent">STEP {i + 1}</span>
          </div>
          <div className="font-semibold mt-3">{title}</div>
          <p className="text-sm text-muted mt-1">{text}</p>
        </div>
      ))}
      <p className="sm:col-span-3 text-sm text-muted">
        The money sits in a NEAR smart contract the whole time, not with the organizer or with us.{" "}
        <Link href="/guide" className="text-accent">Guide & FAQ →</Link>
      </p>
    </section>
  );
}

function EventGrid({ items, empty }: { items: EventView[]; empty?: string }) {
  return (
    <section>
      {items.length === 0 && empty && <p className="text-muted">{empty}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((e) => (
          <Link key={e.id} href={`/e/${e.id}`} className="card p-3 flex gap-4 hover:border-accent/50 transition-colors">
            <Cover event={e} className="w-28 h-28 rounded-xl shrink-0 [&>span]:hidden" />
            <div className="min-w-0 flex-1 py-1">
              <div className="flex items-center gap-2 text-sm text-muted">
                {new Date(e.metadata.starts_at).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                <StatusPill status={e.status} />
              </div>
              <div className="font-semibold mt-1 truncate">{e.metadata.title}</div>
              <div className="text-sm text-muted truncate">{e.metadata.location}</div>
              <div className="text-sm mt-2">
                <span className="font-medium">{formatUsdc(e.deposit)} USDC</span>
                <span className="text-muted"> · {spotsLine(e)}</span>
              </div>
            </div>
            <div className="hidden sm:block py-1">
              <DateBadge ms={e.metadata.starts_at} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
