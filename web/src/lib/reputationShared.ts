export interface Reputation {
  /** Closed events the account was checked in at (escrow `get_attended_count`). */
  attended: number;
  /** Events the account created and did not cancel. */
  hosted: number;
  /** Guests checked in at the account's closed events. */
  guestsCame: number;
}

type HostedEvent = { host: string; status: string; attended_count: number };

// shortcut: counts only the 100 most recent events (get_recent_events); add a per-host counter to the escrow if hosts outgrow it.
export function hostedStats(all: HostedEvent[], account: string): Pick<Reputation, "hosted" | "guestsCame"> {
  const mine = all.filter((e) => e.host === account && e.status !== "Cancelled");
  return { hosted: mine.length, guestsCame: mine.reduce((n, e) => n + (e.status === "Finalized" ? e.attended_count : 0), 0) };
}
