export interface Reputation {
  /** Closed events the account was checked in at (escrow `get_attended_count`). */
  attended: number;
  /** Events the account hosted and closed (Finalized): held, not just planned. */
  hosted: number;
  /** Guests checked in at those events. */
  guestsCame: number;
}

type HostedEvent = { host: string; status: string; attended_count: number };

/** Pass every event (`events.all()`), not a recent page, or the counts come out short. */
export function hostedStats(all: HostedEvent[], account: string): Pick<Reputation, "hosted" | "guestsCame"> {
  const held = all.filter((e) => e.host === account && e.status === "Finalized");
  return { hosted: held.length, guestsCame: held.reduce((n, e) => n + e.attended_count, 0) };
}
