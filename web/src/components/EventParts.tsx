"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { Avatar, AvatarStack, shortAccount } from "./ui";
import { AccountQr } from "./Qr";

/** "12 going · 8 spots left", or "Full". */
export function spotsLine(event: EventView): string {
  if (event.status !== "Open") return `${event.guest_count} registered`;
  const left = event.capacity - event.guest_count;
  return `${event.guest_count} going · ${left > 0 ? `${left} spot${left === 1 ? "" : "s"} left` : "full"}`;
}

/** The rules, right by the button, so nobody is surprised later. */
export function RulesBox({ event }: { event: EventView }) {
  const d = formatUsdc(event.deposit);
  return (
    <div className="rounded-2xl bg-accent-soft text-sm p-4 space-y-3 leading-relaxed">
      <div>
        <div className="font-semibold text-accent">How it works</div>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>Everyone puts down the same {d} USDC.</li>
          <li>
            The host checks you in at the door. Deposits of people who don’t come are <b>split equally among those who
            came</b>.
          </li>
          <li>After the event your deposit and your share land in your balance. Withdraw any time.</li>
        </ul>
      </div>
      <div>
        <div className="font-semibold text-accent">Good to know</div>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>You can’t cancel once you’re registered.</li>
          <li>Only a check-in by the host or a co-host counts.</li>
          <li>If the host cancels, or never closes the event within 30 days, everyone gets their deposit back.</li>
          <li>The money is held by a NEAR smart contract, not the organizer. No platform fee.</li>
        </ul>
      </div>
    </div>
  );
}

type Badge = { label: string; tone: "accent" | "good" | "muted" };

function badge(event: EventView, g: GuestView): Badge {
  if (event.status === "Cancelled") return { label: "Refunded", tone: "muted" };
  if (event.status === "Finalized")
    return g.status === "Attended"
      ? { label: `Got ${formatUsdc(event.payout_per_attendee)} USDC`, tone: "good" }
      : { label: "No-show", tone: "muted" };
  return g.status === "Attended" ? { label: "Checked in ✓", tone: "good" } : { label: "Going", tone: "accent" };
}

const TONE = {
  accent: "bg-accent-soft text-accent",
  good: "bg-good/15 text-good",
  muted: "bg-border/60 text-muted",
};

/** Everyone who registered, with where they stand. Public, like the chain. */
/** Who's going: an avatar stack; the full list with statuses opens on click. */
export function GuestGrid({ event, guests, me }: { event: EventView; guests: GuestView[]; me?: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const closed = event.status !== "Open";
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = guests.filter((g) => g.account_id.toLowerCase().includes(q));
    return [...list.filter((g) => g.account_id === me), ...list.filter((g) => g.account_id !== me)];
  }, [guests, query, me]);

  if (guests.length === 0) return <p className="text-sm text-muted">No one yet. Be the first.</p>;

  return (
    <div className="space-y-3">
      <button className="flex items-center gap-3 w-full text-left group" onClick={() => setOpen(!open)}>
        <AvatarStack accounts={guests.map((g) => g.account_id)} max={6} />
        <span className="text-sm">
          {closed ? `${event.attended_count} of ${event.guest_count} came` : spotsLine(event)}
        </span>
        <span className="ml-auto text-xs text-muted group-hover:text-text">{open ? "Hide" : "See all"}</span>
      </button>
      {open && (
        <>
          {guests.length > 20 && (
            <input className="input text-sm" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {shown.map((g) => {
              const b = badge(event, g);
              return (
                <Link
                  href={`/u/${encodeURIComponent(g.account_id)}`}
                  key={g.account_id}
                  className={`flex flex-col items-center text-center gap-1 p-2 rounded-xl hover:bg-border/40 ${b.tone === "muted" ? "opacity-40" : ""}`}
                >
                  <Avatar account={g.account_id} size={40} />
                  <div className="text-xs truncate max-w-full" title={g.account_id}>
                    {g.account_id === me ? "You" : shortAccount(g.account_id)}
                  </div>
                  {b.tone === "good" && <span className="text-[11px] text-good">{b.label}</span>}
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function googleCalendarUrl(event: EventView, url: string): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: event.metadata.title,
    dates: `${fmt(event.metadata.starts_at)}/${fmt(event.metadata.ends_at)}`,
    details: `You put down ${formatUsdc(event.deposit)} USDC. Get checked in to get it back plus a share.\n${url}`,
    location: event.metadata.location,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function icsUrl(event: EventView, url: string): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Near Events//EN",
    "BEGIN:VEVENT",
    `UID:near-events-${event.id}@near-events`,
    `DTSTAMP:${fmt(Date.now())}`,
    `DTSTART:${fmt(event.metadata.starts_at)}`,
    `DTEND:${fmt(event.metadata.ends_at)}`,
    `SUMMARY:${esc(event.metadata.title)}`,
    `LOCATION:${esc(event.metadata.location)}`,
    `DESCRIPTION:${esc(`Get checked in to get your deposit back plus a share. ${url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

/** Shown once you're in: the door pass and one calendar button. */
export function NextSteps({ event, accountId }: { event: EventView; accountId: string }) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/e/${event.id}`;
  return (
    <div className="space-y-3 text-center">
      <div className="font-semibold">You’re going 🎉</div>
      <div className="flex justify-center">
        <AccountQr account={accountId} size={168} />
      </div>
      <p className="text-sm text-muted">
        Show this at the door to get checked in. After the event, withdraw your deposit plus your share right here.
      </p>
      <details className="relative">
        <summary className="btn btn-ghost w-full text-sm list-none cursor-pointer">Add to calendar</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a className="btn btn-ghost text-sm" href={googleCalendarUrl(event, url)} target="_blank" rel="noopener">Google</a>
          <a className="btn btn-ghost text-sm" href={icsUrl(event, url)} download={`event-${event.id}.ics`}>Apple / Outlook</a>
        </div>
      </details>
    </div>
  );
}
