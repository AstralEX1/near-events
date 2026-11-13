// What the keeper should send for one Deposit event, from public views only.
// Pure, so tests and the "settle" button share it with the cron tick.

export interface KeeperEvent {
  id: number;
  mode?: string;
  status: string;
  dao?: string | null;
  open_disputes?: number;
  challenge_ends_at?: number;
  resolve_by?: number;
  submit_by?: number;
}

export interface KeeperDispute {
  target: string;
  challenger: string;
  attended: boolean;
  upheld: boolean | null;
}

/** A proposal already in the DAO (`get_proposals`). */
export interface DaoProposal {
  proposer: string;
  description: string;
  kind: unknown;
  status: string;
}

export type KeeperAction =
  | { kind: "settle"; eventId: number }
  | { kind: "refund"; eventId: number }
  | { kind: "propose"; eventId: number; dao: string; target: string; upheld: boolean; description: string };

/** The proposal description starts with this; the bot finds its earlier proposals by it. */
export const proposalTag = (escrow: string, eventId: number, target: string, upheld: boolean) =>
  `nearvent:dispute:${escrow}:${eventId}:${target}:${upheld ? "uphold" : "dismiss"}`;

export function proposalDescription(escrow: string, eventId: number, d: KeeperDispute, upheld: boolean, site: string): string {
  const claim = d.attended ? `${d.target} says they came` : `${d.challenger} says ${d.target} did not come`;
  const verdict = upheld ? "the challenger is right" : "the host's list stands";
  return `${proposalTag(escrow, eventId, d.target, upheld)} — ${claim}. Approve if ${verdict}. Evidence: ${site}/e/${eventId}#disputes`;
}

/**
 * Whether the bot's own verdict proposal is already in the DAO. Anyone with
 * AddProposal (any council member, a leaked bot key) can copy the description,
 * so it counts only if the bot proposed it with exactly this call. An expired,
 * failed or removed one is proposed again; a rejected one is not (the council said no).
 */
export function hasVerdictProposal(existing: DaoProposal[], bot: string, wanted: Extract<KeeperAction, { kind: "propose" }>, escrow: string) {
  const kind = JSON.stringify(verdictProposal(wanted, escrow).proposal.kind);
  return existing.some((p) => p.proposer === bot && JSON.stringify(p.kind) === kind && ["InProgress", "Approved", "Rejected"].includes(p.status));
}

/** Block time and server time differ by seconds: act a minute after a deadline, never on its edge. */
export const CLOCK_MARGIN_MS = 60_000;

/** Settle or refund once the escrow allows it; otherwise one Uphold / Dismiss proposal pair per undecided dispute. */
export function planEvent(
  e: KeeperEvent,
  now: number,
  disputes: KeeperDispute[],
  existing: DaoProposal[],
  escrow: string,
  site: string,
  bot: string,
): KeeperAction[] {
  if (e.mode === "Ticket") return [];
  if (e.status === "Open") return e.submit_by && now > e.submit_by + CLOCK_MARGIN_MS ? [{ kind: "refund", eventId: e.id }] : [];
  if (e.status !== "Submitted") return [];
  const open = e.open_disputes ?? 0;
  const due = (deadline?: number) => now >= (deadline ?? Infinity) + CLOCK_MARGIN_MS;
  if (due(e.challenge_ends_at) && (open === 0 || due(e.resolve_by))) return [{ kind: "settle", eventId: e.id }];
  // A proposal created this late could not be voted through before the escrow stops taking verdicts.
  if (!open || !e.dao || now >= (e.resolve_by ?? 0) - CLOCK_MARGIN_MS) return [];
  const actions: KeeperAction[] = [];
  for (const d of disputes) {
    if (d.upheld !== null) continue;
    for (const upheld of [true, false]) {
      const action = { kind: "propose" as const, eventId: e.id, dao: e.dao, target: d.target, upheld, description: proposalDescription(escrow, e.id, d, upheld, site) };
      if (!hasVerdictProposal(existing, bot, action, escrow)) actions.push(action);
    }
  }
  return actions;
}

/** `add_proposal` arguments for one verdict: the DAO calls the escrow's `resolve_dispute` itself. */
export function verdictProposal(a: Extract<KeeperAction, { kind: "propose" }>, escrow: string) {
  const args = JSON.stringify({ event_id: a.eventId, target: a.target, upheld: a.upheld });
  return {
    proposal: {
      description: a.description,
      kind: {
        FunctionCall: {
          receiver_id: escrow,
          actions: [{
            method_name: "resolve_dispute",
            args: btoa(String.fromCharCode(...new TextEncoder().encode(args))),
            deposit: "0",
            gas: "30000000000000",
          }],
        },
      },
    },
  };
}
