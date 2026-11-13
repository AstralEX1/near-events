import { EVENTS_CONTRACT, RPC_URL, USDC_CONTRACT, USDC_DECIMALS } from "./config";
import type { AccessCheck, AccessRule } from "./access";

/** Deposit events: Open → (host publishes the list) Submitted → (window, disputes) Finalized; or Cancelled / Refunded. */
export type EventStatus = "Open" | "Submitted" | "Finalized" | "Cancelled" | "Refunded";
export type GuestStatus = "Registered" | "Attended";
/** Deposit: show-ups split the no-shows' deposits. Ticket: a paid ticket, money to the host at registration. Never both. */
export type EventMode = "Deposit" | "Ticket";

export const isTicket = (e: { mode?: EventMode }) => e.mode === "Ticket";
/** The council called a published list off (`void_event`): hosts can only cancel before publishing. */
export const voidedByCouncil = (e: { status: EventStatus; submitted_at?: number }) => e.status === "Cancelled" && (e.submitted_at ?? 0) > 0;

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
  /** USDC locked by the host; registration opens once it equals `bond_due`. */
  host_bond?: string;
  /** The bond this event needs: `rules.bond_per_seat` deposits per seat (v3); 0 for Ticket or without a court. */
  bond_due?: string;
  /** The owner's rules copied when the event was created (v3). */
  rules?: { dao: string | null; treasury: string; bond_per_seat: number; close_at_start: boolean; challenge_hours: number; submit_hours: number; resolve_hours: number };
  /** Registration closes at this time: `starts_at` for Deposit (v3), `ends_at` for Ticket. */
  registration_ends_at?: number;
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
export const hostBondFor = (e: { bond_due?: string }) => e.bond_due ?? "0";
/** How long guests may dispute the published list (v3 rules; 12 h by default). */
export const windowHours = (e: Pick<EventView, "rules">) => e.rules?.challenge_hours ?? 12;
/** "1 hour", "12 hours", "3 days" (whole days from 48 h). */
export const hoursText = (h: number) => (h >= 48 && h % 24 === 0 ? `${h / 24} days` : `${h} hour${h === 1 ? "" : "s"}`);
export const windowText = (e: Pick<EventView, "rules">) => hoursText(windowHours(e));
/** "no bond" / "one deposit per seat" / "2 deposits per seat". */
export const bondPerSeatText = (e: Pick<EventView, "rules">) => {
  const n = e.rules?.bond_per_seat ?? 0;
  return n === 0 ? "no bond" : n === 1 ? "one deposit per seat" : `${n} deposits per seat`;
};
/** Older escrows take guests until the end. */
export const registrationEndsAt = (e: Pick<EventView, "registration_ends_at" | "metadata">) => e.registration_ends_at ?? e.metadata.ends_at;
/** Deposit events that still need the host bond before guests can register (as the escrow: a court may ask for none). */
export const needsBond = (e: EventView) => !isTicket(e) && e.status === "Open" && BigInt(e.bond_due ?? "0") > 0n && BigInt(e.host_bond ?? "0") === 0n;
/** The escrow takes guests now (seats and the access rule aside). */
export const registrationOpen = (e: EventView) => e.status === "Open" && Date.now() < registrationEndsAt(e) && !needsBond(e);
/** Counts as came: the host's list while it waits out the dispute window, the status otherwise (Manage puts door check-ins there). */
export const cameOf = (e: Pick<EventView, "status">, g: GuestView) => (e.status === "Submitted" ? !!g.listed : g.status === "Attended");

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
  /** The owner's rules that new events copy (v3 escrow). */
  config: () => view<{ owner: string; rules?: NonNullable<EventView["rules"]>; oracle_hour_ms?: number }>("get_config"),
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
