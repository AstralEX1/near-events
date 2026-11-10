"use client";

import { useEffect, useState } from "react";
import { events } from "./near";
import { hostedStats, type Reputation } from "./reputationShared";

/** Attended (on-chain counter) and hosted numbers for one account; null while loading or if the chain is unreachable. */
export function useReputation(account: string | null): Reputation | null {
  const [rep, setRep] = useState<Reputation | null>(null);
  useEffect(() => {
    if (!account) return;
    let live = true;
    setRep(null);
    Promise.all([events.attendedCount(account), events.list()])
      .then(([attended, all]) => live && setRep({ attended, ...hostedStats(all, account) }))
      .catch(() => live && setRep(null));
    return () => {
      live = false;
    };
  }, [account]);
  return rep;
}

/** On-chain attended counts for a guest list, ten RPC views at a time; accounts that fail are left out. */
export async function attendedCounts(accounts: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < accounts.length; i += 10) {
    const chunk = accounts.slice(i, i + 10);
    const counts = await Promise.all(chunk.map((a) => events.attendedCount(a).catch(() => null)));
    chunk.forEach((a, j) => {
      if (counts[j] !== null) out[a] = counts[j];
    });
  }
  return out;
}
