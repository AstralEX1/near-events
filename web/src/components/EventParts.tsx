"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { Avatar, shortAccount } from "./ui";
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
type Filter = "all" | "going" | "in" | "out";
type Sort = "new" | "old" | "name";

/** Everyone who registered, with where they stand. Public, like the chain. */
export function GuestGrid({ event, guests, me }: { event: EventView; guests: GuestView[]; me?: string | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("new");
  const closed = event.status !== "Open";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = guests.filter(
      (g) =>
        g.account_id.toLowerCase().includes(q) &&
        (filter === "all" ||
          (filter === "in" && g.status === "Attended") ||
          (filter === "going" && g.status === "Registered" && !closed) ||
          (filter === "out" && g.status === "Registered" && closed)),
    );
    list.sort((a, b) =>
      sort === "name" ? a.account_id.localeCompare(b.account_id) : sort === "old" ? a.registered_at - b.registered_at : b.registered_at - a.registered_at,
    );
    // You first, so you can always find yourself.
    return [...list.filter((g) => g.account_id === me), ...list.filter((g) => g.account_id !== me)];
  }, [guests, query, filter, sort, closed, me]);

  const filters: [Filter, string][] = closed
    ? [["all", "All"], ["in", event.status === "Finalized" ? "Got paid" : "Checked in"], ["out", "No-show"]]
    : [["all", "All"], ["going", "Going"], ["in", "Checked in"]];

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3 pb-2 border-b border-border">
        <div className="font-semibold">Guests</div>
        <div className="text-sm text-muted">{spotsLine(event)}</div>
        <div className="text-sm text-muted ml-auto">
          {event.attended_count}/{event.guest_count} {closed ? "showed up" : "checked in"}
        </div>
      </div>
      {guests.length === 0 ? (
        <p className="text-sm text-muted">Nobody yet. Be the first.</p>
      ) : (
        <>
          <input
            className="input mb-2 text-sm"
            placeholder="Search by account or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex items-center gap-2 mb-3 text-sm">
            <div className="flex rounded-xl border border-border p-0.5">
              {filters.map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFilter(v)}
                  className={`px-2.5 py-1 rounded-lg ${filter === v ? "bg-accent-soft text-accent font-medium" : "text-muted"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <select
              className="ml-auto bg-transparent text-muted outline-none cursor-pointer"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort guests"
            >
              <option value="new">Newest</option>
              <option value="old">Oldest</option>
              <option value="name">A–Z</option>
            </select>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {shown.map((g) => {
              const b = badge(event, g);
              return (
                <Link
                  href={`/u/${encodeURIComponent(g.account_id)}`}
                  key={g.account_id}
                  className={`flex flex-col items-center text-center gap-1.5 p-2 rounded-xl hover:bg-border/40 ${g.account_id === me ? "bg-accent-soft/60" : ""}`}
                >
                  <Avatar account={g.account_id} size={44} />
                  <div className="text-xs font-medium truncate max-w-full" title={g.account_id}>
                    {g.account_id === me ? "You" : shortAccount(g.account_id)}
                  </div>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TONE[b.tone]}`}>{b.label}</span>
                </Link>
              );
            })}
          </div>
          {shown.length === 0 && <p className="text-sm text-muted">No guests match.</p>}
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

/** Shown once you're in: what happens next, and a calendar reminder. */
export function NextSteps({ event, accountId }: { event: EventView; accountId: string }) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/e/${event.id}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar account={accountId} size={40} />
        <div>
          <div className="font-semibold">You’re going 🎉</div>
          <div className="text-sm text-muted">{formatUsdc(event.deposit)} USDC is held for you in the contract.</div>
        </div>
      </div>
      <ol className="space-y-2 text-sm">
        {[
          "Add it to your calendar and come on time. Only people the host checks in get paid.",
          <>
            At the door, tell the host your account: <b className="break-all">{shortAccount(accountId)}</b>.
          </>,
          "Snap a photo at the event. If the host forgets to check you in, it’s your proof.",
          "Back on this page, your badge should turn “Checked in ✓”. Not there? Ask the host before the event closes.",
          "When the host closes the event, press “Withdraw payout” here: your deposit plus your share.",
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-accent-soft text-accent text-xs font-semibold flex items-center justify-center">
              {i + 1}
            </span>
            <span className="pt-0.5">{t}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-4 rounded-2xl border border-border p-3">
        <AccountQr account={accountId} size={120} />
        <div className="text-sm">
          <div className="font-medium">Your door pass</div>
          <p className="text-muted mt-1">The host scans this to check you in. Screenshot it or just open this page at the door.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a className="btn btn-ghost text-sm" href={googleCalendarUrl(event, url)} target="_blank" rel="noopener">
          Google Calendar
        </a>
        <a className="btn btn-ghost text-sm" href={icsUrl(event, url)} download={`event-${event.id}.ics`}>
          Apple / Outlook (.ics)
        </a>
      </div>
    </div>
  );
}
