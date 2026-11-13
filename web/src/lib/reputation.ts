"use client";

import { useEffect, useState } from "react";
import type { Reputation } from "./reputationShared";

/** Counters and the score from `/api/reputation`, 50 accounts per request. */
export async function fetchReputation(accounts: string[]): Promise<Record<string, Reputation>> {
  const out: Record<string, Reputation> = {};
  for (let i = 0; i < accounts.length; i += 50) {
    const chunk = accounts.slice(i, i + 50);
    const res = await fetch(`/api/reputation?a=${chunk.map(encodeURIComponent).join(",")}`);
    if (!res.ok) throw new Error("Reputation is unavailable");
    Object.assign(out, (await res.json()).accounts);
  }
  return out;
}

/** Reputation of one account; null while loading or if the chain is unreachable. */
export function useReputation(account: string | null): Reputation | null {
  const [rep, setRep] = useState<Reputation | null>(null);
  useEffect(() => {
    if (!account) return;
    let live = true;
    setRep(null);
    fetchReputation([account])
      .then((all) => live && setRep(all[account] ?? null))
      .catch(() => live && setRep(null));
    return () => {
      live = false;
    };
  }, [account]);
  return rep;
}

/** Attended counts for a guest list; accounts that fail are left out. */
export async function attendedCounts(accounts: string[]): Promise<Record<string, number>> {
  const all = await fetchReputation(accounts).catch(() => ({} as Record<string, Reputation>));
  return Object.fromEntries(Object.entries(all).map(([a, r]) => [a, r.attended]));
}
