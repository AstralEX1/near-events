// Access rules: who may register for an event, judged by the same host's
// earlier finalized events. Mirrors `AccessRule` in the escrow; the escrow
// decides (`check_access`), this file only builds and describes rules.

export interface AccessRule {
  /** The host's own finalized events the rule looks at, 1 to MAX_RULE_EVENTS. */
  past_events: number[];
  /** Came to at least this many of them. */
  min_attended: number;
  /** Skipped at most this many; null: no limit. */
  max_no_shows: number | null;
  /** From this time (ms) anyone may register; null: never. */
  open_to_all_at: number | null;
}

export interface AccessCheck {
  allowed: boolean;
  attended: number;
  no_shows: number;
}

/** Mirrors the escrow's MAX_RULE_EVENTS. */
export const MAX_RULE_EVENTS = 10;

export type AccessChoice = "everyone" | "regulars-first" | "regulars-only";

/** The host's finalized events, newest first, as many as a rule can hold. */
export function rulePastEvents(all: { id: number; host: string; status: string }[], host: string): number[] {
  return all
    .filter((e) => e.host === host && e.status === "Finalized")
    .map((e) => e.id)
    .sort((a, b) => b - a)
    .slice(0, MAX_RULE_EVENTS);
}

/** The `access` argument of `create_event`; null lets everyone in. */
export function buildRule(choice: AccessChoice, o: {
  pastEvents: number[];
  minAttended: number;
  skipNoShows: boolean;
  /** Regulars first: when everyone may register. */
  openToAllAt?: number;
}): AccessRule | null {
  if (choice === "everyone") return null;
  return {
    past_events: o.pastEvents,
    min_attended: o.minAttended,
    max_no_shows: o.skipNoShows ? 0 : null,
    open_to_all_at: choice === "regulars-first" ? o.openToAllAt ?? null : null,
  };
}

/** Why the rule can't be created yet, or null; mirrors the escrow's checks. */
/** `closesAt`: when registration closes (the start for Deposit events, the end otherwise). */
export function ruleProblem(rule: AccessRule | null, closesAt: number): string | null {
  if (!rule) return null;
  const n = rule.past_events.length;
  if (n === 0) return "Regulars need one of your events to be finalized first";
  if (rule.min_attended < 1 || rule.min_attended > n) return `Regulars: pick 1 to ${n} past events`;
  if (rule.open_to_all_at !== null && rule.open_to_all_at >= closesAt) return "Open the event to everyone before registration closes";
  return null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One line for the event page, e.g. "Regulars only: guests who came to 1 of the host's last 3 events, until Sat, Nov 14, 6:00 PM. Then open to everyone." */
export function ruleText(rule: AccessRule, now = Date.now(),
  formatTime = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })): string {
  if (rule.open_to_all_at !== null && now >= rule.open_to_all_at) return "Open to everyone.";
  const last = `the host's last ${plural(rule.past_events.length, "event")}`;
  const m = rule.max_no_shows;
  const noShows = m === null ? "" : m === 0 ? " and never skipped one" : ` with at most ${plural(m, "no-show")}`;
  const base = rule.min_attended > 0
    ? `Regulars only: guests who came to ${rule.min_attended} of ${last}${noShows}`
    : `Everyone except people who skipped ${m === 0 ? "any" : `more than ${m}`} of ${last}`;
  return rule.open_to_all_at === null ? `${base}.` : `${base}, until ${formatTime(rule.open_to_all_at)}. Then open to everyone.`;
}
