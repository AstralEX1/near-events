"use client";

import { useCallback, useEffect, useState } from "react";
import { savedStaffToken, useWallet } from "./wallet";
import type { FreeEvent } from "./freeEventsShared";
import { toast } from "@/components/SlUi";

/** Loads one free event and saves changes to it. Shared by /f/<id> and its Manage page. */
export function useFreeEvent(id: string) {
  const { accountId, staffToken } = useWallet();
  const [event, setEvent] = useState<FreeEvent | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // A saved sign-in token (never a wallet prompt) lets the host see requests and a guest see their own.
    const token = accountId ? savedStaffToken(accountId) : null;
    const response = await fetch(`/api/free-events?id=${encodeURIComponent(id)}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (response?.status === 404 || response?.status === 400) return setEvent(null);
    const json = await response?.json().catch(() => null);
    if (!response?.ok || !json?.event) return setError("Couldn’t load this event. Please try again in a moment.");
    setEvent(json.event as FreeEvent);
  }, [id, accountId]);
  useEffect(() => void load(), [load]);

  // Signed-in saves reuse the token from sign-in: no wallet window here.
  const post = async (body: object, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      const token = await staffToken();
      const response = await fetch("/api/free-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...body, id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error ?? "Could not save. Try again.");
      await load();
      if (done) toast(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return { accountId, event, busy, error, post };
}
