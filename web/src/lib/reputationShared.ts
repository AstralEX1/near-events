import { score, type ScoreInput, type ScoreParts } from "./score.ts";

/** A NEAR account id (also 0x Intents accounts); imported guests like "balisquad:name" are not. */
export const isAccountId = (a: string) => a.length >= 2 && a.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a);

export interface Reputation {
  /** Closed events the account was checked in at (final status Attended). */
  attended: number;
  /** Events the account hosted and closed (Finalized): held, not just planned. */
  hosted: number;
  /** Guests checked in at those events. */
  guestsCame: number;
  /** The single score (0-100) and its parts; absent while the chain is unreachable. */
  score?: number;
  parts?: ScoreParts;
  /** Deposit events with a final list: registered but did not come. */
  noShows?: number;
  disputesWon?: number;
  disputesLost?: number;
  /** Deposit events the account hosted and never published a list for. Not in the score, shown as a fact. */
  abandoned?: number;
}

type HostedEvent = { host: string; status: string; attended_count: number; abandoned?: boolean };

/** Pass every event (`events.all()`), not a recent page, or the counts come out short. */
export function hostedStats(all: HostedEvent[], account: string): Pick<Reputation, "hosted" | "guestsCame"> {
  // An abandoned event (no list from the host) was settled, but not held by them.
  const held = all.filter((e) => e.host === account && e.status === "Finalized" && !e.abandoned);
  return { hosted: held.length, guestsCame: held.reduce((n, e) => n + e.attended_count, 0) };
}

/** An organizer whose events count four times as much, for events created in [from, to). */
export interface TrustedHost {
  account: string;
  from: number;
  to?: number;
}

export interface ChainEvent {
  id: number;
  host: string;
  status: string;
  mode?: string;
  created_at: number;
  attended_count: number;
  upheld_disputes?: number;
  abandoned?: boolean;
}

export interface ChainFacts {
  /** Every event (`get_events`). */
  events: (ChainEvent & HostedEvent)[];
  /** Final guest lists of the Finalized events, by event id. */
  guests: Record<number, { account_id: string; status: string }[]>;
  /** Disputes of the Finalized Deposit events, by event id. */
  disputes: Record<number, { challenger: string; created_at: number; via_intents: boolean; upheld: boolean | null }[]>;
}

const trustedAt = (list: TrustedHost[], host: string, at: number) =>
  list.some((t) => t.account === host && at >= t.from && (t.to === undefined || at < t.to));

/**
 * Reputation of every account that appears in `facts`, computed only from
 * public on-chain records and the public trusted-host list (SPEC H1).
 * Ticket and free events count for the badges, never for the score.
 */
export function reputationIndex(facts: ChainFacts, trusted: TrustedHost[]): Map<string, Reputation> {
  const settled = facts.events.filter((e) => e.status === "Finalized").sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  type Entry = ScoreInput & { attendedAll: number; disputes: { at: number; lost: boolean }[]; wonAt: Set<string> };
  const inputs = new Map<string, Entry>();
  const of = (account: string) => {
    let entry = inputs.get(account);
    if (!entry) {
      entry = { attended: [], noShows: 0, hosted: [], disputesWon: 0, disputesLost: 0, attendedAll: 0, disputes: [], wonAt: new Set() };
      inputs.set(account, entry);
    }
    return entry;
  };
  // How often each guest with a trusted history already counted for a host (at most 3 times).
  const vouched = new Map<string, number>();
  // When each account first came to an event of a trusted host (event creation time).
  const firstTrusted = new Map<string, number>();
  for (const e of settled) {
    const deposit = e.mode !== "Ticket";
    const trustedHost = trustedAt(trusted, e.host, e.created_at);
    const guests = facts.guests[e.id] ?? [];
    let withHistory = 0;
    for (const g of guests) {
      const came = g.status === "Attended";
      if (came) of(g.account_id).attendedAll++;
      if (!deposit) continue;
      if (came) {
        of(g.account_id).attended.push({ host: e.host, trusted: trustedHost });
        const first = firstTrusted.get(g.account_id);
        const key = `${e.host}\u0000${g.account_id}`;
        // The same few friends with a trusted past cannot vouch for every event of a host.
        if (first !== undefined && first < e.created_at && (vouched.get(key) ?? 0) < 3) {
          withHistory++;
          vouched.set(key, (vouched.get(key) ?? 0) + 1);
        }
      } else if (e.attended_count > 0 && !e.abandoned) {
        // Nobody came: everyone was refunded, so it is not a no-show. Without a
        // host's list, an absence is not proven either.
        of(g.account_id).noShows++;
      }
    }
    if (deposit) {
      if (trustedHost) {
        for (const g of guests) if (g.status === "Attended" && !firstTrusted.has(g.account_id)) firstTrusted.set(g.account_id, e.created_at);
      }
      if (!e.abandoned) of(e.host).hosted.push({ attendees: e.attended_count, withHistory, upheld: e.upheld_disputes ?? 0 });
      for (const d of facts.disputes[e.id] ?? []) {
        // An Intents payment names the challenger without proof: it neither counts for nor against that name.
        if (d.via_intents) continue;
        const c = of(d.challenger);
        // Wins count once per host, so a host's own staged disputes cannot farm Civic.
        if (d.upheld === true && !c.wonAt.has(e.host)) {
          c.disputesWon++;
          c.wonAt.add(e.host);
        }
        c.disputes.push({ at: d.created_at, lost: d.upheld === false });
      }
    }
  }
  const out = new Map<string, Reputation>();
  for (const [account, input] of inputs) {
    input.disputesLost = input.disputes.sort((a, b) => a.at - b.at).slice(-10).filter((d) => d.lost).length;
    const { score: value, parts } = score(input);
    out.set(account, {
      attended: input.attendedAll,
      ...hostedStats(facts.events, account),
      score: value,
      parts,
      noShows: input.noShows,
      disputesWon: input.disputesWon,
      disputesLost: input.disputesLost,
      abandoned: facts.events.filter((e) => e.host === account && (e.status === "Refunded" || e.abandoned)).length,
    });
  }
  return out;
}

/** What an account with no settled history gets. */
export const emptyReputation = (facts: Pick<ChainFacts, "events">, account: string): Reputation => ({
  attended: 0,
  ...hostedStats(facts.events, account),
  score: 0,
  parts: { attendance: 0, hosting: 0, civic: 0, penalty: 0 },
  noShows: 0,
  disputesWon: 0,
  disputesLost: 0,
  abandoned: facts.events.filter((e) => e.host === account && (e.status === "Refunded" || e.abandoned)).length,
});
