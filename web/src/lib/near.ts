import { EVENTS_CONTRACT, RPC_URL, USDC_CONTRACT, USDC_DECIMALS } from "./config";

export type EventStatus = "Open" | "Finalized" | "Cancelled";
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
}

export interface GuestView {
  account_id: string;
  status: GuestStatus;
  registered_at: number;
  paid_by: string;
}

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
  /** Browser only: recent events without the ones their hosts made Private (link only). */
  listPublic: async () => {
    const [all, hidden] = await Promise.all([
      events.list(),
      // shortcut: if the private list is unavailable, listings show every event; fine while Private means unlisted, not secret.
      fetch("/api/event-details?private=1", { cache: "no-store" }).then((r) => r.json()).then((j) => new Set<number>(j.ids ?? [])).catch(() => new Set<number>()),
    ]);
    return all.filter((e) => !hidden.has(e.id));
  },
  get: (id: number) => view<EventView | null>("get_event", { event_id: id }),
  guests: (id: number) => view<GuestView[]>("get_guests", { event_id: id, from_index: 0, limit: MAX_CAPACITY }),
  guestStatus: (id: number, account: string) =>
    view<GuestStatus | null>("get_guest_status", { event_id: id, account_id: account }),
  /** One call for up to 100 events, in the order of `ids`. */
  guestStatuses: (account: string, ids: number[]) => ids.length === 0
    ? Promise.resolve([] as (GuestStatus | null)[])
    : view<(GuestStatus | null)[]>("get_guest_statuses", { account_id: account, event_ids: ids.slice(0, RECENT_LIMIT) }),
  balance: (account: string) => view<string>("balance_of", { account_id: account }),
  /** yoctoNEAR the host must attach to create this event now; "0" on the free tier. */
  createCost: (host: string, capacity: number) => view<string>("create_event_cost", { host, capacity }),
  /** Finalized events the account was checked in at. */
  attendedCount: (account: string) => view<number>("get_attended_count", { account_id: account }),
};

/** Mirrors the escrow: free tier and the technical seat cap. */
export const FREE_MAX_CAPACITY = 50;
export const FREE_MAX_OPEN_EVENTS = 2;
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
