"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { events, toUnits } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";

/**
 * The one page a host opens: the Telegram bot drafted the event, the host
 * signs in once and confirms. The event is created from the host's own
 * account; then the host signs a short message so our server links the event
 * to the Telegram chat (the bot may check guests in, never move money).
 */
export default function ConfirmEvent() {
  const q = useSearchParams();
  const { accountId, send, staffToken } = useWallet();
  const [bot, setBot] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const title = q.get("title") ?? "";
  const startWall = q.get("start") ?? ""; // "2026-11-14T19:00", the host's local time
  const deposit = q.get("deposit") ?? "";
  const capacity = Number(q.get("cap") ?? "0");
  const token = q.get("t") ?? "";

  useEffect(() => {
    fetch("/api/telegram/link").then((r) => r.json()).then((j) => setBot(j.bot)).catch(() => {});
  }, []);

  const starts = startWall ? new Date(startWall) : null; // parsed in this browser's time zone
  const valid = title && starts && !isNaN(starts.getTime()) && Number(deposit) >= 0.1 && capacity > 0 && token;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!bot) throw new Error("The bot isn’t set up on this server yet.");
      if (!accountId) throw new Error("Sign in first.");
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title,
              starts_at: starts!.getTime(),
              ends_at: starts!.getTime() + 3 * 3600_000,
            },
            deposit: toUnits(deposit),
            capacity,
          },
          deposit: BigInt(await events.createCost(accountId, capacity, starts!.getTime() + 3 * 3600_000)),
        },
      ]);
      const mine = (await events.list()).find((e) => e.host === accountId && e.metadata.title === title);
      if (!mine) throw new Error("Created, but I couldn’t find the event yet. Send /status to the bot in a minute.");
      const auth = await staffToken();
      const r = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ token, eventId: mine.id }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Couldn’t connect the event to Telegram");
      setDone(mine.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!valid) return <p className="text-muted">This link is incomplete. Send /new to the bot again.</p>;

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div>
        <div className="text-sm text-muted">Confirm your event</div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">{title}</h1>
        <p className="text-muted mt-1">
          {starts!.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
        <p className="mt-2">
          <b>{deposit} USDC</b> deposit · {capacity} spots
        </p>
      </div>

      {done !== null ? (
        <div className="space-y-2">
          <p className="font-semibold text-good">✓ Created. Head back to Telegram.</p>
          <p className="text-sm text-muted">The bot sent you the button for your website and will ping you on every deposit.</p>
        </div>
      ) : !accountId ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">Sign in once. The event and its money stay under your account.</p>
          <SignInOptions />
        </div>
      ) : (
        <button className="btn btn-accent w-full !py-3.5" disabled={busy} onClick={create}>
          {busy ? "Confirm in your wallet…" : "Create Event"}
        </button>
      )}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      <p className="text-xs text-muted">
        Creating an event is free up to 50 seats and 2 open events; beyond that you pay a little NEAR for storage. After the wallet step you sign
        one short message so the Nearvent bot can check guests in for this event. Payouts and
        refunds always need your confirmation.
      </p>
    </div>
  );
}
