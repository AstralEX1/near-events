"use client";

import Link from "next/link";
import { formatUsdc, priceLabel, isTicket, type EventView } from "@/lib/near";
import { Cover } from "./ui";

/** Luma-style list: a date on the left, that day's events as cards on the right. */
export function Timeline({ items, empty }: { items: EventView[]; empty: string }) {
  if (items.length === 0) return <p className="text-muted">{empty}</p>;
  const days = new Map<string, EventView[]>();
  for (const e of items) {
    const key = new Date(e.metadata.starts_at).toDateString();
    days.set(key, [...(days.get(key) ?? []), e]);
  }
  return (
    <div className="space-y-8">
      {[...days.entries()].map(([key, list]) => {
        const d = new Date(key);
        return (
          <div key={key} className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="sm:pt-3">
              <div className="font-semibold">{d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              <div className="text-sm text-muted">{d.toLocaleDateString("en-US", { weekday: "long" })}</div>
            </div>
            <div className="space-y-3">
              {list.map((e) => (
                <Link key={e.id} href={`/e/${e.id}`} className="gc-list-card p-5 flex gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm text-muted">
                      {new Date(e.metadata.starts_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    </div>
                    <div className="font-semibold text-lg leading-snug">{e.metadata.title}</div>
                    <div className="text-sm pt-1">
                      {e.status === "Finalized" ? (
                        <span className="text-muted">
                          {e.attended_count} of {e.guest_count} came{!isTicket(e) && ` · ${formatUsdc(e.payout_per_attendee)} USDC per checked-in guest`}
                        </span>
                      ) : e.status === "Cancelled" ? (
                        <span className="text-muted">Cancelled</span>
                      ) : (
                        <>
                          <span className="inline-block px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-medium mr-2">
                            {priceLabel(e)}
                          </span>
                          <span className="text-muted">{e.guest_count >= e.capacity ? "Full" : `${e.guest_count} going`}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Cover event={e} className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl shrink-0 [&>span]:hidden" />
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
