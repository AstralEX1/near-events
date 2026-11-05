"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { events, formatUsdc, isTicket, priceLabel, type EventView } from "@/lib/near";
import { embedQuery, embedVars, readEmbedStyle, type EmbedMessage } from "@/lib/embed";
import { AvatarStack, Cover, DateBadge, formatWhen } from "@/components/ui";
import { spotsLine } from "@/components/EventParts";

/**
 * The event card other sites put in an iframe (directly or through /embed.js).
 * Sign-up happens in a small window of our own, where wallets and Google
 * sign-in work normally; the card hears back and tells the host page.
 */
export default function EmbedCard() {
  const id = Number(useParams<{ id: string }>().id);
  const q = useSearchParams();
  const style = readEmbedStyle(q);
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [guests, setGuests] = useState<string[]>([]);
  const [joined, setJoined] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([events.get(id).catch(() => null), events.guests(id).catch(() => [])]);
    setEvent(e);
    setGuests(g.map((x) => x.account_id));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Tell the host page our height so its iframe never scrolls.
  useEffect(() => {
    const el = root.current;
    if (!el || window.parent === window) return;
    const post = () =>
      window.parent.postMessage({ type: "near-events:resize", height: Math.ceil(el.getBoundingClientRect().height) } satisfies EmbedMessage, "*");
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [event]);

  // The sign-up window reports back here; pass it on to the host page.
  useEffect(() => {
    const onMessage = (e: MessageEvent<EmbedMessage>) => {
      if (e.origin !== window.location.origin || e.data?.type !== "near-events:registered" || e.data.eventId !== id) return;
      setJoined(true);
      load();
      if (window.parent !== window) window.parent.postMessage(e.data, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, load]);

  const joinUrl = `/embed/e/${id}/join${embedQuery(q)}`;
  const open = (ev: React.MouseEvent) => {
    const w = window.open(joinUrl, `near-events-${id}`, "popup,width=460,height=760");
    if (w) ev.preventDefault(); // Otherwise the link opens it in a new tab.
  };

  return (
    <div ref={root} className="embed p-px" style={embedVars(style)}>
      {event === undefined && <div className="card p-4 text-sm text-muted">Loading event…</div>}
      {event === null && <div className="card p-4 text-sm text-muted">This event was not found.</div>}
      {event && (
        <div className="card overflow-hidden">
          <div className="flex gap-4 p-3">
            <Cover event={event} className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl shrink-0 [&>span]:hidden" />
            <div className="min-w-0 flex-1 py-0.5">
              <h2 className="embed-title text-lg sm:text-xl font-semibold leading-snug line-clamp-2">{event.metadata.title}</h2>
              <div className="flex items-center gap-2 mt-2 text-sm">
                <DateBadge ms={event.metadata.starts_at} />
                <div className="min-w-0">
                  <div className="truncate">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
                  <div className="text-muted truncate">{event.metadata.location || "Location TBA"}</div>
                </div>
              </div>
            </div>
          </div>
          <div className="px-3 pb-3 space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2 min-w-0">
                {guests.length > 0 && <AvatarStack accounts={guests} max={5} />}
                <span className="text-muted truncate">
                  {spotsLine(event)}{isTicket(event) ? "" : ` · pool ${formatUsdc(event.total_pool)} USDC`}
                </span>
              </div>
            </div>
            <CardAction event={event} joined={joined} joinUrl={joinUrl} onOpen={open} />
            <p className="text-xs text-muted">
              {isTicket(event)
                ? `${formatUsdc(event.deposit)} USDC ticket, refunded if the host cancels`
                : `Show up and get your ${formatUsdc(event.deposit)} USDC back plus a share of the no-shows`} ·{" "}
              <a href={`/e/${event.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">
                Near Events
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CardAction({
  event,
  joined,
  joinUrl,
  onOpen,
}: {
  event: EventView;
  joined: boolean;
  joinUrl: string;
  onOpen: (e: React.MouseEvent) => void;
}) {
  if (joined) return <div className="btn btn-ghost w-full text-good">✓ You’re going</div>;
  if (event.status === "Finalized") return <div className="btn btn-ghost w-full text-muted">{isTicket(event) ? "Event ended" : "Event ended · pool paid out"}</div>;
  if (event.status === "Cancelled") return <div className="btn btn-ghost w-full text-muted">{isTicket(event) ? "Cancelled · tickets refunded" : "Cancelled · deposits returned"}</div>;
  if (event.guest_count >= event.capacity) return <div className="btn btn-ghost w-full text-muted">Event is full</div>;
  return (
    <a href={joinUrl} target="_blank" rel="opener" onClick={onOpen} className="btn btn-accent w-full">
      {isTicket(event) ? "Get ticket" : "Register"} · {priceLabel(event)}
    </a>
  );
}
