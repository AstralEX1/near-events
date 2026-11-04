import { EVENTS_CONTRACT, RPC_URL, USDC_CONTRACT, USDC_DECIMALS } from "./config";

export type EventStatus = "Open" | "Finalized" | "Cancelled";
export type GuestStatus = "Registered" | "Attended";

export interface EventMetadata {
  title: string;
  description: string;
  location: string;
  cover_url: string | null;
  starts_at: number;
  ends_at: number;
}

export interface EventView {
  id: number;
  host: string;
  cohosts: string[];
  metadata: EventMetadata;
  deposit: string;
  capacity: number;
  status: EventStatus;
  guest_count: number;
  attended_count: number;
  total_pool: string;
  payout_per_attendee: string;
  created_at: number;
  /** When the event was finalized or cancelled; 0 while open. */
  closed_at: number;
  /** Guest records still on chain; 0 after the guest list was cleaned up (7+ days after close). */
  stored_guests: number;
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
  if (json.error || json.result?.error) throw new Error(json.error?.data ?? json.result.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

export const events = {
  list: async () => {
    const count = await view<number>("get_events_count");
    const from = Math.max(0, count - 50);
    return (await view<EventView[]>("get_events", { from_index: from, limit: 50 })).reverse();
  },
  get: (id: number) => view<EventView | null>("get_event", { event_id: id }),
  guests: (id: number) => view<GuestView[]>("get_guests", { event_id: id, from_index: 0, limit: 300 }),
  guestStatus: (id: number, account: string) =>
    view<GuestStatus | null>("get_guest_status", { event_id: id, account_id: account }),
  guestEvents: (account: string) => view<number[]>("get_guest_events", { account_id: account }),
  balance: (account: string) => view<string>("balance_of", { account_id: account }),
  openEventsOf: (account: string) => view<number>("open_events_of", { account_id: account }),
};

export const usdc = {
  balance: (account: string) => view<string>("ft_balance_of", { account_id: account }, USDC_CONTRACT),
  isRegistered: async (account: string) =>
    (await view<object | null>("storage_balance_of", { account_id: account }, USDC_CONTRACT)) !== null,
};

export function formatUsdc(units: string | bigint, digits = 2): string {
  const n = Number(BigInt(units)) / 10 ** USDC_DECIMALS;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function toUnits(usd: string | number): string {
  const [whole, frac = ""] = String(usd).split(".");
  return (BigInt(whole || "0") * 10n ** BigInt(USDC_DECIMALS) + BigInt((frac + "000000").slice(0, USDC_DECIMALS))).toString();
}
