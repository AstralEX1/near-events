"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUsdc, isTicket, type EventView, type GuestView } from "@/lib/near";
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
  if (isTicket(event)) {
    return (
      <div className="rounded-2xl bg-accent-soft text-sm p-4 space-y-3 leading-relaxed">
        <div>
          <div className="font-semibold text-accent">How it works</div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            <li>A ticket costs {d} USDC.</li>
            <li>The money goes to the host as soon as you register. Tickets are not refunded.</li>
            <li>The host checks you in at the door with your QR pass.</li>
          </ul>
        </div>
        <div>
          <div className="font-semibold text-accent">Good to know</div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            <li>If the host cancels, refunds go to your Nearvent balance. If the event stays open for 30 days, a refund can be requested.</li>
            <li>No platform fee.</li>
          </ul>
        </div>
      </div>
    );
  }
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
          {event.dao ? (
            <li>
              After the event the host publishes who came. Guests have 12 hours to dispute it, and a council of 5 decides.
              Then your deposit and share are credited to your Nearvent balance. You can then withdraw.
            </li>
          ) : (
            <li>After the host closes the event, your deposit and share are credited to your Nearvent balance. You can then withdraw.</li>
          )}
        </ul>
      </div>
      <div>
        <div className="font-semibold text-accent">Good to know</div>
        <ul className="list-disc pl-5 mt-1 space-y-0.5">
          <li>You can’t cancel once you’re registered.</li>
          {event.dao ? (
            <>
              <li>Registration closes when the event starts. The host’s list counts unless a guest disputes it. Marked absent by mistake? Open a dispute within 12 hours.</li>
              <li>The host locks a bond of one deposit per seat and loses it if proven wrong. If the host cancels before the start or publishes no list within 3 days, you get your deposit back.</li>
            </>
          ) : (
            <>
              <li>Only a check-in by the host or their door team counts.</li>
              <li>If the host cancels, refunds go to your Nearvent balance. If the event stays open for 30 days, a refund can be requested.</li>
            </>
          )}
          <li>The money is held by a NEAR smart contract, not the organizer. No platform fee.</li>
        </ul>
      </div>
    </div>
  );
}

/** Under each guest after the event: what they made, or that they didn't come. Nothing before. */
function note(event: EventView, g: GuestView): { text: string; dim: boolean } | null {
  if (event.status === "Cancelled" || event.status === "Refunded") return isTicket(event) ? null : { text: "refunded", dim: false };
  if (event.status === "Submitted") return g.listed || event.abandoned ? null : { text: "marked absent", dim: true };
  if (event.status !== "Finalized") return null;
  if (isTicket(event)) return g.status === "Attended" ? { text: "came", dim: false } : null;
  if (g.status !== "Attended") return { text: "no-show", dim: true };
  const profit = BigInt(event.payout_per_attendee) - BigInt(event.deposit);
  return { text: profit > 0n ? `+${formatUsdc(profit)}` : "came", dim: false };
}

/** Who's going, as a plain grid like Kickback's participants. Search appears for big events. */
export function GuestGrid({ event, guests, me }: { event: EventView; guests: GuestView[]; me?: string | null }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = guests.filter((g) => g.account_id.toLowerCase().includes(q));
    return [...list.filter((g) => g.account_id === me), ...list.filter((g) => g.account_id !== me)];
  }, [guests, query, me]);

  const line =
    event.status === "Finalized" ? `${event.attended_count} of ${event.guest_count} showed up` : spotsLine(event);

  return (
    <div className="space-y-4 pt-3 border-t border-border">
      <div className="font-semibold">{line}</div>
      {guests.length === 0 && <p className="text-sm text-muted">No one yet. Be the first.</p>}
      {guests.length > 20 && (
        <input className="input text-sm" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-x-3 gap-y-4">
        {shown.map((g) => {
          const n = note(event, g);
          return (
            <Link
              href={`/u/${encodeURIComponent(g.account_id)}`}
              key={g.account_id}
              className={`flex flex-col items-center text-center gap-1 ${n?.dim ? "opacity-50 grayscale" : ""}`}
            >
              <Avatar account={g.account_id} size={48} />
              <span className="text-[13px] font-medium truncate max-w-full" data-tooltip={g.account_id}>
                {g.account_id === me ? "You" : shortAccount(g.account_id)}
              </span>
              {n && <span className={`text-xs ${n.dim ? "text-muted" : "text-good"}`}>{n.text}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function googleCalendarUrl(event: EventView, url: string): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: event.metadata.title,
    dates: `${fmt(event.metadata.starts_at)}/${fmt(event.metadata.ends_at)}`,
    details: isTicket(event)
      ? `Your ticket: ${formatUsdc(event.deposit)} USDC. Show your QR pass at the door.\n${url}`
      : `You put down ${formatUsdc(event.deposit)} USDC. Get checked in to get it back plus a share.\n${url}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function icsUrl(event: EventView, url: string): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Nearvent//EN",
    "BEGIN:VEVENT",
    `UID:near-events-${event.id}@near-events`,
    `DTSTAMP:${fmt(Date.now())}`,
    `DTSTART:${fmt(event.metadata.starts_at)}`,
    `DTEND:${fmt(event.metadata.ends_at)}`,
    `SUMMARY:${esc(event.metadata.title)}`,
    `DESCRIPTION:${esc(isTicket(event) ? `Show your QR pass at the door. ${url}` : `Get checked in to get your deposit back plus a share. ${url}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

/** Shown once you're in: the door pass, one line, and a calendar link. */
export function NextSteps({ event, accountId }: { event: EventView; accountId: string }) {
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/e/${event.id}`;
  const [cal, setCal] = useState(false);
  return (
    <div className="gc-pass">
      <div className="gc-pass-code"><AccountQr account={accountId} size={160} /></div>
      <div className="gc-pass-copy space-y-2 min-w-0">
        <div className="font-semibold text-xl">You’re on the list.</div>
        <p className="text-sm text-muted">Show this code at the door to get checked in.</p>
        {cal ? (
          <div className="flex gap-3 text-sm font-medium">
            <a className="text-accent" href={googleCalendarUrl(event, url)} target="_blank" rel="noopener">Google</a>
            <a className="text-accent" href={icsUrl(event, url)} download={`event-${event.id}.ics`}>Apple / Outlook</a>
          </div>
        ) : (
          <button className="text-sm font-medium text-accent" onClick={() => setCal(true)}>Add to calendar</button>
        )}
      </div>
    </div>
  );
}
