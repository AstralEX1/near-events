import { EVENTS_CONTRACT, RPC_URL, USDC_CONTRACT, USDC_DECIMALS } from "./config";
import type { AccessCheck, AccessRule } from "./access";

/** Deposit events: Open → (host publishes the list) Submitted → (window, disputes) Finalized; or Cancelled / Refunded. */
export type EventStatus = "Open" | "Submitted" | "Finalized" | "Cancelled" | "Refunded";
export type GuestStatus = "Registered" | "Attended";
/** Deposit: show-ups split the no-shows' deposits. Ticket: a paid ticket, money to the host at registration. Never both. */
export type EventMode = "Deposit" | "Ticket";

export const isTicket = (e: { mode?: EventMode }) => e.mode === "Ticket";

/** What the escrow keeps about an event. Location, description and cover live off-chain (api/event-details). */
export interface EventMetadata {
  title: string;
  starts_at: number;
  ends_at: number;
}

export interface EventView {
  id: number;
  host: string;
  metadata: EventMetadata;
  /** What each guest pays: the deposit, or the ticket price when `mode` is "Ticket". */
  deposit: string;
  mode: EventMode;
  capacity: number;
  status: EventStatus;
  guest_count: number;
  attended_count: number;
  total_pool: string;
  payout_per_attendee: string;
  created_at: number;
  /** When the event was finalized or cancelled; 0 while open. */
  closed_at: number;
  /** Who may register; null lets everyone in. */
  access?: AccessRule | null;
  /** Deposit events (v3 escrow): the DAO that decides disputes; null for tickets. */
  dao?: string | null;
  /** Deposit events: receives the treasury share of lost bonds, fixed at creation. */
  treasury?: string | null;
  /** USDC locked by the host; registration opens once it is `HOST_BOND_MULTIPLIER` deposits. */
  host_bond?: string;
  /** When the host published the list; 0 before. */
  submitted_at?: number;
  /** Disputes are accepted until this time (exclusive); 0 before the list. */
  challenge_ends_at?: number;
  /** DAO verdicts until this time (exclusive); later, open disputes expire. */
  resolve_by?: number;
  /** The host must publish the list by this time (inclusive); after it, anyone refunds. */
  submit_by?: number;
  open_disputes?: number;
  upheld_disputes?: number;
  dismissed_disputes?: number;
  /** The host published no list in time; `refund` published an empty one in their place. */
  abandoned?: boolean;
}

export interface GuestView {
  account_id: string;
  /** Final once the event is Finalized; Deposit events show the host's claim in `listed` before that. */
  status: GuestStatus;
  registered_at: number;
  /** Deposit: on the host's published list. */
  listed?: boolean;
}

export interface DisputeView {
  target: string;
  challenger: string;
  /** The claim: the target came (true) or did not (false). */
  attended: boolean;
  created_at: number;
  /** Paid through NEAR Intents, so the challenger's name is unproven. */
  via_intents: boolean;
  /** The DAO's verdict: true = the challenger is right; null = not decided (expires at `resolve_by`). */
  upheld: boolean | null;
}

/** Mirrors the escrow (v3). */
export const HOST_BOND_MULTIPLIER = 5n;
export const hostBondFor = (e: { deposit: string }) => (BigInt(e.deposit) * HOST_BOND_MULTIPLIER).toString();
/** Deposit events that still need the host bond before guests can register. */
export const needsBond = (e: EventView) => !!e.dao && !isTicket(e) && e.status === "Open" && BigInt(e.host_bond ?? "0") === 0n;

/** Read-only contract call over JSON-RPC. */
export async function view<T>(method: string, args: object = {}, contractId = EVENTS_CONTRACT): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "view",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) throw new Error(JSON.stringify(json.error ?? json.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

/** The contract returns at most this many recent events and batched guest statuses. */
export const RECENT_LIMIT = 100;

export const events = {
  /** The newest events first, up to 100. */
  list: () => view<EventView[]>("get_recent_events", { limit: RECENT_LIMIT }),
  /** Browser only: recent events (or with `everything`, all of them) without the ones their hosts made Private (link only). */
  listPublic: async (everything = false) => {
    const [all, hidden] = await Promise.all([
      everything ? events.all() : events.list(),
      // shortcut: if the private list is unavailable, listings show every event; fine while Private means unlisted, not secret.
      fetch("/api/event-details?private=1", { cache: "no-store" }).then((r) => r.json()).then((j) => new Set<number>(j.ids ?? [])).catch(() => new Set<number>()),
    ]);
    return all.filter((e) => !hidden.has(e.id));
  },
  get: (id: number) => view<EventView | null>("get_event", { event_id: id }),
  guests: (id: number) => view<GuestView[]>("get_guests", { event_id: id, from_index: 0, limit: MAX_CAPACITY }),
  /** Disputes about the event's records, in registration order. */
  disputes: (id: number) => view<DisputeView[]>("get_disputes", { event_id: id, from_index: 0, limit: MAX_CAPACITY }),
  guestStatus: (id: number, account: string) =>
    view<GuestStatus | null>("get_guest_status", { event_id: id, account_id: account }),
  /** In the order of `ids`, one call per 100 events. */
  guestStatuses: async (account: string, ids: number[]) => {
    const out: (GuestStatus | null)[] = [];
    for (let i = 0; i < ids.length; i += RECENT_LIMIT) {
      out.push(...await view<(GuestStatus | null)[]>("get_guest_statuses", { account_id: account, event_ids: ids.slice(i, i + RECENT_LIMIT) }));
    }
    return out;
  },
  balance: (account: string) => view<string>("balance_of", { account_id: account }),
  /** False while the whitelist mode is on and `host` is not on the list. */
  canCreate: (host: string) => view<boolean>("can_create", { host }),
  /** yoctoNEAR the host must attach to create this event now; "0" on the free tier. */
  createCost: (host: string, capacity: number, endsAt?: number) =>
    view<string>("create_event_cost", { host, capacity, ends_at: endsAt ?? null }),
  /** Every event in creation order, paged through `get_events`. */
  all: async () => {
    const out: EventView[] = [];
    for (;;) {
      const page = await view<EventView[]>("get_events", { from_index: out.length, limit: RECENT_LIMIT });
      out.push(...page);
      if (page.length < RECENT_LIMIT) return out;
    }
  },
  /** Whether `account` may register under the event's access rule now. */
  checkAccess: (id: number, account: string) => view<AccessCheck>("check_access", { event_id: id, account_id: account }),
};

/** Mirrors the escrow: free tier and the technical seat cap. */
export const FREE_MAX_CAPACITY = 50;
/** Free events per host in any 30 days; closing one early does not give it back. */
export const FREE_MAX_EVENTS = 2;
/** A free event must end within this many days. */
export const FREE_MAX_DAYS = 60;
export const MAX_CAPACITY = 300;

/** yoctoNEAR → "0.33" NEAR, rounded up so the hint never undersells. */
export function formatNear(yocto: string | bigint, digits = 2): string {
  const step = 10n ** BigInt(24 - digits);
  const units = (BigInt(yocto) + step - 1n) / step;
  return (Number(units) / 10 ** digits).toFixed(digits);
}

export const usdc = {
  balance: (account: string) => view<string>("ft_balance_of", { account_id: account }, USDC_CONTRACT),
  isRegistered: async (account: string) =>
    (await view<object | null>("storage_balance_of", { account_id: account }, USDC_CONTRACT)) !== null,
};

export function formatUsdc(units: string | bigint, digits = 2): string {
  const n = Number(BigInt(units)) / 10 ** USDC_DECIMALS;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** "20 USDC ticket" or "10 USDC deposit". */
export function priceLabel(e: { deposit: string; mode?: EventMode }): string {
  return `${formatUsdc(e.deposit)} USDC ${isTicket(e) ? "ticket" : "deposit"}`;
}

export function toUnits(usd: string | number): string {
  const [whole, frac = ""] = String(usd).split(".");
  return (BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt((frac + "000000").slice(0, USDC_DECIMALS))).toString();
}
