// Free events: no deposit, no ticket, nothing on chain. They live only on our server
// (lib/freeEvents.ts) and open at /f/<id>. Shared by the browser and the API.
import { locationProblem } from "./eventImport.ts";
import { validEventVisual, type EventVisualConfig } from "./event-visuals.ts";

export interface FreeEventInput {
  title: string;
  starts_at: number;
  ends_at: number;
  capacity: number;
  location: string;
  description: string;
  cover_url: string | null;
  visual: EventVisualConfig;
  /** Public events show in the /events feed; private ones only by link. */
  public: boolean;
  /** Guests ask to join and the host approves each one. Missing on older events means off. */
  approval?: boolean;
}

export interface FreeEvent extends FreeEventInput {
  id: string;
  host: string;
  created_at: number;
  guest_count: number;
  /** Only in the single-event response; the feed leaves it out. */
  guests?: string[];
  /** Pending join requests: only sent to the host. */
  requests?: string[];
  /** Whether the signed-in viewer has a pending request. */
  requested?: boolean;
}

export const MAX_FREE_CAPACITY = 1000;
const bytes = (s: string) => new TextEncoder().encode(s).length;

function safeHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Why this input can't be saved, or null when it can. Runs on the server for every create. */
export function freeEventProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Bad event";
  const e = value as Record<string, unknown>;
  if (typeof e.title !== "string" || !e.title.trim() || bytes(e.title) > 120) return "Title is empty or too long.";
  if (!Number.isSafeInteger(e.starts_at) || !Number.isSafeInteger(e.ends_at)) return "Bad event time.";
  if ((e.ends_at as number) <= (e.starts_at as number)) return "The event has to end after it starts.";
  if (!Number.isInteger(e.capacity) || (e.capacity as number) < 1 || (e.capacity as number) > MAX_FREE_CAPACITY) return `Set the capacity: 1 to ${MAX_FREE_CAPACITY}`;
  if (typeof e.location !== "string") return "Bad location.";
  const location = locationProblem(e.location);
  if (location) return location;
  if (typeof e.description !== "string" || bytes(e.description) > 10_000) return "Event details are too long.";
  if (e.cover_url !== null && (typeof e.cover_url !== "string" || !safeHttpUrl(e.cover_url))) return "Use a public HTTP or HTTPS image link for the cover image.";
  if (!validEventVisual(e.visual)) return "Bad event theme.";
  if (typeof e.public !== "boolean") return "Bad visibility.";
  if (e.approval !== undefined && typeof e.approval !== "boolean") return "Bad approval setting.";
  return null;
}

/** Ids are short random base64url strings, so they never clash with on-chain numeric ids. */
export const isFreeEventId = (value: string) => /^[A-Za-z0-9_-]{8,16}$/.test(value);
