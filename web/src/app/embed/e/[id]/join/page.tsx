"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { events, type EventView, type GuestStatus } from "@/lib/near";
import { embedVars, readEmbedStyle, type EmbedMessage } from "@/lib/embed";
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
  const style = readEmbedStyle(useSearchParams());
  const { accountId, ready } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const told = useRef(false);

  const load = useCallback(async () => {
    const [e, s] = await Promise.all([
      events.get(id).catch(() => null),
      accountId ? events.guestStatus(id, accountId).catch(() => null) : Promise.resolve(null),
    ]);
    setEvent(e);
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
    <div className="embed min-h-screen bg-bg p-4" style={embedVars(style)}>
      <div className="max-w-md mx-auto space-y-4">
        {event === undefined && <p className="text-muted text-sm">Loading…</p>}
        {event === null && <p>Event not found.</p>}
        {event && (
          <>
            <div className="flex gap-3 items-center">
              <Cover event={event} className="w-16 h-16 rounded-xl shrink-0 [&>span]:hidden" />
              <div className="min-w-0">
                <h1 className="embed-title text-xl font-semibold leading-snug">{event.metadata.title}</h1>
                <div className="text-sm text-muted truncate">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
                <div className="text-sm text-muted truncate">{event.metadata.location}</div>
              </div>
            </div>
            {ready ? (
              <RegistrationCard event={event} myStatus={status} onChange={load} />
            ) : (
              <p className="text-muted text-sm">Loading sign-in…</p>
            )}
            {status && (
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
