// Server-only keeper: closes Deposit events once the escrow allows it and opens
// the DAO proposal pair for every new dispute. Everything it sends is
// permissionless (`settle`, `refund`) or a proposal the council still has to
// vote on, so a leaked relayer key cannot move anyone's money.
import "server-only";
import { EVENTS_CONTRACT } from "./config";
import { events, view, type EventView } from "./near";
import { relayer } from "./relayer";
import { planEvent, verdictProposal, type DaoProposal, type KeeperAction } from "./keeperPlan";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.nearvent.site";
/** At most this many proposals are read per DAO and tick (newest first). */
const MAX_SCAN = 2_000;
/** The court's policy asks no proposal bond; any other DAO setup is refused, not paid. */
const MAX_PROPOSAL_BOND = 0n;
/** Below this free balance the DAO cannot store many more proposals (≈0.015 NEAR each) or votes. */
export const DAO_LOW_BALANCE = 3n * 10n ** 23n;

type Proposal = DaoProposal & { submission_time: string };
type Policy = { proposal_bond?: string };

/** The DAO's proposals back to `since` (ms): every one that could belong to a dispute still open. */
async function daoState(dao: string, since: number) {
  const [last, policy, available] = await Promise.all([
    view<number>("get_last_proposal_id", {}, dao),
    view<Policy>("get_policy", {}, dao),
    // The free part of the balance: the total also backs the DAO's own storage.
    view<string>("get_available_amount", {}, dao),
  ]);
  const proposals: DaoProposal[] = [];
  for (let to = last; to > 0 && last - to < MAX_SCAN; to -= 100) {
    const from = Math.max(0, to - 100);
    const page = await view<Proposal[]>("get_proposals", { from_index: from, limit: to - from }, dao);
    proposals.push(...page);
    if (page.some((p) => Number(BigInt(p.submission_time) / 1_000_000n) < since)) break;
  }
  return { proposals, bond: BigInt(policy.proposal_bond ?? "0"), available: BigInt(available) };
}

export interface KeeperPlan {
  actions: KeeperAction[];
  /** DAOs whose free balance (`get_available_amount`) is running low, in yoctoNEAR. */
  lowDaos: { dao: string; balance: string }[];
  bonds: Record<string, string>;
}

/** What to send now for these events (any order, any mode). */
export async function planKeeper(list: EventView[], now = Date.now()): Promise<KeeperPlan> {
  const bot = process.env.RELAYER_ACCOUNT_ID ?? "";
  const pending = list.filter((e) => e.mode !== "Ticket" && (e.status === "Open" || e.status === "Submitted"));
  const disputed = (e: EventView) => e.status === "Submitted" && (e.open_disputes ?? 0) > 0 && !!e.dao;
  // Proposals can only be as old as the oldest event that is waiting for a verdict.
  const since = new Map<string, number>();
  for (const e of pending.filter(disputed)) since.set(e.dao!, Math.min(since.get(e.dao!) ?? Infinity, e.submitted_at ?? 0));
  const daos = new Map<string, Promise<Awaited<ReturnType<typeof daoState>>>>();
  const plan: KeeperPlan = { actions: [], lowDaos: [], bonds: {} };
  for (const e of pending) {
    const disputes = disputed(e) ? await events.disputes(e.id) : [];
    let existing: DaoProposal[] = [];
    if (disputed(e)) {
      if (!daos.has(e.dao!)) daos.set(e.dao!, daoState(e.dao!, since.get(e.dao!)!));
      const state = await daos.get(e.dao!)!;
      existing = state.proposals;
      plan.bonds[e.dao!] = state.bond.toString();
      if (state.available < DAO_LOW_BALANCE && !plan.lowDaos.some((d) => d.dao === e.dao)) {
        plan.lowDaos.push({ dao: e.dao!, balance: state.available.toString() });
      }
    }
    plan.actions.push(...planEvent(e, now, disputes, existing, EVENTS_CONTRACT, SITE, bot));
  }
  return plan;
}

export interface KeeperResult {
  action: KeeperAction["kind"];
  eventId: number;
  target?: string;
  upheld?: boolean;
  ok: boolean;
  hash?: string;
  error?: string;
}

/**
 * Sends the actions one by one with the relayer key; a failure does not stop
 * the rest. At most `maxProposals` proposals per run, "I came" claims first
 * (the likely victims); none to a DAO that is low on storage or after its
 * first failed proposal in this run, so a broken DAO costs one transaction a run.
 */
export async function runKeeper(plan: KeeperPlan, maxProposals = 20): Promise<KeeperResult[]> {
  const account = relayer();
  const out: KeeperResult[] = [];
  const blocked = new Set(plan.lowDaos.map((d) => d.dao));
  let proposals = 0;
  const ordered = [...plan.actions].sort((x, y) => Number(y.kind === "propose" && y.upheld) - Number(x.kind === "propose" && x.upheld));
  for (const a of ordered) {
    const base: KeeperResult = { action: a.kind, eventId: a.eventId, ok: false };
    try {
      let call;
      if (a.kind === "propose") {
        base.target = a.target;
        base.upheld = a.upheld;
        if (blocked.has(a.dao) || proposals >= maxProposals) continue;
        proposals++;
        const bond = BigInt(plan.bonds[a.dao] ?? "0");
        if (bond > MAX_PROPOSAL_BOND) {
          blocked.add(a.dao);
          throw new Error(`The DAO asks a proposal bond of ${bond} yoctoNEAR; the court policy has none`);
        }
        call = { contractId: a.dao, methodName: "add_proposal", args: verdictProposal(a, EVENTS_CONTRACT), deposit: bond, gas: 50_000_000_000_000n };
      } else {
        call = { contractId: EVENTS_CONTRACT, methodName: a.kind, args: { event_id: a.eventId }, gas: 300_000_000_000_000n };
      }
      const outcome = await account.callFunctionRaw({ ...call, waitUntil: "FINAL" });
      const failure = [outcome.status, ...outcome.receipts_outcome.map((r) => r.outcome.status)]
        .map((s) => (s as { Failure?: unknown }).Failure)
        .find(Boolean);
      out.push({ ...base, ok: !failure, hash: outcome.transaction.hash, ...(failure ? { error: JSON.stringify(failure).slice(0, 300) } : {}) });
      if (failure && a.kind === "propose") blocked.add(a.dao);
    } catch (e) {
      out.push({ ...base, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
      if (a.kind === "propose") blocked.add(a.dao);
    }
  }
  return out;
}

/** Every event that may still need the keeper: Open or Submitted, Deposit mode. */
export async function pendingEvents(): Promise<EventView[]> {
  const all = await events.all();
  return all.filter((e) => e.mode !== "Ticket" && (e.status === "Open" || e.status === "Submitted"));
}

/**
 * One run at a time per `name` across instances when Redis is configured (a
 * second concurrent run would only send duplicates the escrow or DAO then
 * refuses, or a duplicate proposal pair). Returns false if the lock is held.
 */
export async function keeperLock(name = "tick", seconds = 240): Promise<boolean> {
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  if (!url || !token) return true;
  const key = `near-me:${process.env.NEXT_PUBLIC_NETWORK ?? "testnet"}:keeper:lock:${name}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, "1", "NX", "EX", String(seconds)]),
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return r.ok && (await r.json()).result === "OK";
  } catch {
    return false;
  }
}
