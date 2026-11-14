"use client";

import { useEffect, useState } from "react";
import { isAccountId, type Reputation } from "./reputationShared.ts";

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

// Every name on a page asks for its own numbers; asks made in the same tick go out as one request.
// Answers are kept a minute, so a list of 50 guests is one request, not 50, and a closed event shows up soon.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rep: Promise<Reputation | null> }>();
let queue: { account: string; resolve: (r: Reputation | null) => void }[] = [];

function flush() {
  const batch = queue;
  queue = [];
  fetchReputation(batch.map((b) => b.account))
    .then((all) => batch.forEach((b) => b.resolve(all[b.account] ?? null)))
    .catch(() => batch.forEach((b) => {
      cache.delete(b.account);
      b.resolve(null);
    }));
}

export function loadReputation(account: string): Promise<Reputation | null> {
  if (!isAccountId(account)) return Promise.resolve(null);
  const hit = cache.get(account);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rep;
  const rep = new Promise<Reputation | null>((resolve) => {
    if (!queue.length) setTimeout(flush, 0);
    queue.push({ account, resolve });
  });
  cache.set(account, { at: Date.now(), rep });
  return rep;
}

/** Reputation of each account (imported guests and failed loads are left out); asks go out together. */
export function useReputations(accounts: string[]): Record<string, Reputation> {
  const key = accounts.join(",");
  const [reps, setReps] = useState<Record<string, Reputation>>({});
  useEffect(() => {
    let live = true;
    const list = key ? key.split(",") : [];
    void Promise.all(list.map(loadReputation)).then((all) => live && setReps(Object.fromEntries(list.flatMap((a, i) => (all[i] ? [[a, all[i]]] : [])))));
    return () => {
      live = false;
    };
  }, [key]);
  return reps;
}

/** Reputation of one account; null while loading, for imported guests, or if the chain is unreachable. */
export function useReputation(account: string | null): Reputation | null {
  return useReputations(account ? [account] : [])[account ?? ""] ?? null;
}
