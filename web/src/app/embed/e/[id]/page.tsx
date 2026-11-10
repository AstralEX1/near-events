"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { events, formatUsdc, isTicket, type EventView } from "@/lib/near";
import { embedQuery, embedVars, readEmbedStyle, type EmbedMessage } from "@/lib/embed";
import { AvatarStack } from "@/components/ui";
import { spotsLine } from "@/components/EventParts";

/**
 * The deposit block other sites put in an iframe (directly or through /embed.js).
 * The host's own page already shows the event (title, date, place), so this
 * shows only the money part: the deposit, seats left and the pay button.
 * Sign-up happens in a small window of our own, where wallets and Google
 * sign-in work normally; the card hears back and tells the host page.
 */
export default function EmbedCard() {
  const id = Number(useParams<{ id: string }>().id);
  const q = useSearchParams();
  const style = readEmbedStyle(q);
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [guests, setGuests] = useState<string[]>([]);
  const [joined, setJoined] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([events.get(id).catch(() => undefined), events.guests(id).catch(() => [])]);
    if (e === undefined) setLoadError(true);
    else {
      setEvent(e);
      setLoadError(false);
    }
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
    <div ref={root} className="embed p-px" data-theme={style.theme} style={embedVars(style)}>
      {event === undefined && <div className="card p-4 text-sm text-muted">{loadError ? "Could not load this deposit. Check your connection and reload." : "Loading…"}</div>}
      {event === null && <div className="card p-4 text-sm text-muted">This deposit was not found.</div>}
      {event && (
        <div className="card p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-muted">{isTicket(event) ? "Ticket" : "Refundable deposit"}</div>
              <div className="embed-title text-2xl font-semibold leading-tight">{formatUsdc(event.deposit)} USDC</div>
            </div>
            <div className="flex items-center gap-2 min-w-0 text-sm">
              {guests.length > 0 && <AvatarStack accounts={guests} max={4} />}
              <span className="text-muted truncate">{spotsLine(event)}</span>
            </div>
          </div>
          <CardAction event={event} joined={joined} joinUrl={joinUrl} onOpen={open} />
          <p className="text-xs text-muted">
            {isTicket(event)
              ? "Refunded if the host cancels"
              : `Show up and get it back plus a share of the no-shows${Number(event.total_pool) > 0 ? ` · pool ${formatUsdc(event.total_pool)} USDC` : ""}`}{" "}
            · Nearvent
          </p>
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
  if (event.status === "Cancelled") return <div className="btn btn-ghost w-full text-muted">{isTicket(event) ? "Cancelled" : "Cancelled · deposits returned"}</div>;
  if (event.guest_count >= event.capacity) return <div className="btn btn-ghost w-full text-muted">Event is full</div>;
  return (
    <a href={joinUrl} target="_blank" rel="opener" onClick={onOpen} className="btn btn-accent w-full">
      {isTicket(event) ? "Get ticket" : "Pay deposit"} · {formatUsdc(event.deposit)} USDC
    </a>
  );
}
