// The v3 single reputation score (0-100), a line-by-line port of
// docs/oracle-upgrade/evidence/score-v3.py (SPEC H2). Pure: the server builds
// the inputs from on-chain facts (reputationShared.ts) and anyone can recompute it.

export const SCORE_VERSION = 1;
/** "Trusted community member" badge. */
export const TRUST_THRESHOLD = 25;

export interface ScoreInput {
  /** One entry per attended (settled) Deposit event: its host and whether the host was trusted when it was created. */
  attended: { host: string; trusted: boolean }[];
  noShows: number;
  /** Settled Deposit events the account hosted, oldest first. */
  hosted: { attendees: number; withHistory: number; upheld: number }[];
  disputesWon: number;
  /** Lost disputes among the account's last 10 disputes (Intents-paid ones excluded). */
  disputesLost: number;
}

export interface ScoreParts {
  attendance: number;
  hosting: number;
  civic: number;
  penalty: number;
}

/** 0..1, one half at x == k. */
const sat = (x: number, k: number) => (x > 0 ? x / (x + k) : 0);

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Python's round(x, 1) for x >= 0: exact ties (only x.25 and x.75 are exact in binary) go to the even digit. */
function oneDecimal(x: number): number {
  if (Number.isInteger(x * 4) && (x * 4) % 2 !== 0) {
    const tenths = Math.floor(x * 10);
    return (tenths % 2 === 0 ? tenths : tenths + 1) / 10;
  }
  return Number(x.toFixed(1));
}

export function score(input: ScoreInput): { score: number; parts: ScoreParts } {
  const perHost = new Map<string, { trusted: boolean; count: number }>();
  for (const { host, trusted } of input.attended) {
    const key = `${host}\u0000${trusted}`;
    const entry = perHost.get(key) ?? { trusted, count: 0 };
    entry.count++;
    perHost.set(key, entry);
  }
  let trustedPart = 0;
  let rawSum = 0;
  for (const { trusted, count } of perHost.values()) {
    if (trusted) trustedPart += Math.min(count, 3) * 1.0;
    else rawSum += Math.min(count, 3) * 0.25;
  }
  const effective = trustedPart + Math.min(1.0, rawSum);
  const total = input.attended.length + input.noShows;
  const rate = total ? input.attended.length / total : 0;
  const attendance = 50 * sat(effective, 3) * (0.5 + 0.5 * rate);

  let qTrusted = 0;
  let qRaw = 0;
  let corrections = 0;
  input.hosted.forEach(({ attendees, withHistory, upheld }, i) => {
    // Only the last 10 hosted events count against the host.
    if (i >= input.hosted.length - 10) corrections += upheld;
    if (attendees < 3 || upheld) return;
    if (withHistory >= 3) qTrusted += 1.0;
    else qRaw += 0.25;
  });
  const hosting = 35 * sat(qTrusted + Math.min(0.5, qRaw), 3);

  const civic = 15 * sat(input.disputesWon, 2);
  const penalty = Math.min(30, 10 * input.disputesLost) + Math.min(45, 15 * corrections);
  const value = Math.max(0, Math.min(100, roundHalfEven(attendance + hosting + civic - penalty)));
  return {
    score: value,
    parts: { attendance: oneDecimal(attendance), hosting: oneDecimal(hosting), civic: oneDecimal(civic), penalty: penalty ? -penalty : 0 },
  };
}
