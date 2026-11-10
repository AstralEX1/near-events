"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { events, isTicket, type EventView, type GuestStatus } from "@/lib/near";
import { embedQuery, embedVars, readEmbedStyle, readThen, type EmbedMessage } from "@/lib/embed";
import { useWallet } from "@/lib/wallet";
import { Cover, formatWhen } from "@/components/ui";
import { RegistrationCard } from "@/components/Registration";

/**
 * The sign-up window an embed opens. It is a normal top-level page, so wallet
 * pop-ups, Google sign-in and redirects all work. When the guest is in, it
 * tells the embed (window.opener) and offers to close.
 */
export default function EmbedJoin() {
  const id = Number(useParams<{ id: string }>().id);
  const q = useSearchParams();
  const style = readEmbedStyle(q);
  const { accountId, ready } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const told = useRef(false);
  const then = readThen(q, accountId, id);

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([
      events.get(id).catch(() => undefined),
      accountId ? events.guestStatus(id, accountId).catch(() => null) : Promise.resolve(null),
    ]);
    if (e === undefined) setLoadError(true);
    else {
      setEvent(e);
      setLoadError(false);
    }
    setStatus(s);
  }, [id, accountId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!status || !accountId || told.current) return;
    told.current = true;
    const msg: EmbedMessage = { type: "near-events:registered", eventId: id, accountId };
    // The opener is our card iframe or, for embed.js buttons, the host page itself.
    // The guest list is public on-chain, so the message holds nothing secret.
    window.opener?.postMessage(msg, "*");
  }, [status, accountId, id]);

  return (
    <div className="embed min-h-screen bg-bg p-4" data-theme={style.theme} style={embedVars(style)}>
      <div className="gc-checkout space-y-5">
        {event === undefined && <p className="text-muted text-sm">{loadError ? "Could not load event. Check your connection and reload." : "Loading…"}</p>}
        {event === null && <p>Event not found.</p>}
        {event && (
          <>
            <div className="flex gap-3 items-center">
              <Cover event={event} className="w-16 h-16 rounded-xl shrink-0 [&>span]:hidden" />
              <div className="min-w-0">
                <h1 className="embed-title text-xl font-semibold leading-snug">{event.metadata.title}</h1>
                <div className="text-sm text-muted truncate">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
              </div>
            </div>
            {ready ? (
              <RegistrationCard event={event} myStatus={status} onChange={load} embedReturnTo={`/embed/e/${id}/join${embedQuery(q)}`} />
            ) : (
              <p className="text-muted text-sm">Loading sign-in…</p>
            )}
            {status && then && (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted">{isTicket(event) ? "Ticket paid." : "Deposit paid."} One more step on the organizer’s side:</p>
                <a href={then} className="btn btn-accent w-full !py-3.5">Finish registration →</a>
              </div>
            )}
            {status && !then && (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted">You can close this window.</p>
                <button className="btn btn-ghost" onClick={() => window.close()}>Close</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
