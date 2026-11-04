"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { events, type EventView, type GuestStatus } from "@/lib/near";
import { embedVars, readEmbedStyle, readThen, type EmbedMessage } from "@/lib/embed";
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
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const told = useRef(false);
  const [luma, setLuma] = useState(false);
  const then = readThen(q, accountId, id);

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

  // Is this event connected to the host's Luma? Then paid guests get a Luma ticket.
  useEffect(() => {
    fetch(`/api/luma/registered?e=${id}`).then((r) => r.json()).then((j) => setLuma(!!j.luma)).catch(() => {});
  }, [id]);

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
            {status && luma && accountId && <LumaTicket eventId={id} accountId={accountId} />}
            {status && then && (
              <div className="text-center space-y-2">
                <p className="text-sm text-muted">Deposit paid. One more step on the organizer’s side:</p>
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

/** After the deposit, on Luma-connected events: where to send the Luma ticket. */
function LumaTicket({ eventId, accountId }: { eventId: number; accountId: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setState("busy");
    setError(null);
    const r = await fetch("/api/luma/registered", { method: "POST", body: JSON.stringify({ eventId, accountId, name, email }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setState("done");
    else {
      setError(j.error ?? "Something went wrong");
      setState("idle");
    }
  };
  if (state === "done") return <p className="text-sm text-good font-medium text-center">✓ Your ticket is on its way to {email}.</p>;
  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="text-sm font-medium">Where should we send your ticket?</div>
      <input className="input" required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" required type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn btn-accent w-full" disabled={state === "busy"}>{state === "busy" ? "Sending…" : "Get my ticket"}</button>
      {error && <p className="text-sm text-warn">{error}</p>}
    </form>
  );
}
