// Free events (no deposit, no ticket) stored on our server: Upstash Redis when hosted,
// an ignored JSON file under web/.data in local development. Same pattern as eventDetails.ts.
import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";
import { redis, usesRedis } from "./eventDetails";
import type { FreeEvent, FreeEventInput } from "./freeEventsShared";

type Stored = Omit<FreeEvent, "guest_count" | "guests">;

const INDEX = `free-events:${EVENTS_CONTRACT}`;
const key = (id: string) => `free-event:${EVENTS_CONTRACT}:${id}`;
const guestsKey = (id: string) => `free-event-guests:${EVENTS_CONTRACT}:${id}`;

async function pipeline<T>(commands: (string | number)[][]): Promise<T[]> {
  if (!commands.length) return [];
  const response = await fetch(`${process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  const json = await response.json() as { result?: T; error?: string }[];
  if (!response.ok || !Array.isArray(json) || json.some((r) => r.error)) throw new Error("Free event storage request failed");
  return json.map((r) => r.result as T);
}

// ---------------------------------------------------------------- local file

const FILE = path.join(process.cwd(), ".data", "free-events.json");
type FileStore = Record<string, Stored & { guests: string[] }>;
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<FileStore> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile<T>(fn: (store: FileStore) => T): Promise<T> {
  const run = lock.then(async () => {
    const store = await loadFile();
    const out = fn(store);
    await mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2));
    await rename(temp, FILE);
    return out;
  });
  lock = run.catch(() => {});
  return run;
}

// ---------------------------------------------------------------- API

export async function createFreeEvent(host: string, input: FreeEventInput): Promise<string> {
  const id = randomBytes(6).toString("base64url");
  const event: Stored = { ...input, id, host, created_at: Date.now() };
  if (usesRedis()) {
    await redis(["SET", key(id), JSON.stringify(event)]);
    await redis(["SADD", INDEX, id]);
  } else {
    await updateFile((store) => void (store[id] = { ...event, guests: [] }));
  }
  return id;
}

export async function getFreeEvent(id: string): Promise<FreeEvent | null> {
  if (usesRedis()) {
    const [raw, guests] = await pipeline<unknown>([["GET", key(id)], ["SMEMBERS", guestsKey(id)]]);
    if (typeof raw !== "string") return null;
    const list = (guests as string[] | null) ?? [];
    return { ...(JSON.parse(raw) as Stored), guests: list, guest_count: list.length };
  }
  const e = (await loadFile())[id];
  return e ? { ...e, guest_count: e.guests.length } : null;
}

/** Every public free event, without guest lists. */
// shortcut: reads all free events on each request; add paging or a time-sorted index past a few hundred events.
export async function listPublicFreeEvents(): Promise<FreeEvent[]> {
  let all: FreeEvent[];
  if (usesRedis()) {
    const ids = await redis<string[]>(["SMEMBERS", INDEX]);
    const rows = await pipeline<string | number | null>(ids.flatMap((id) => [["GET", key(id)], ["SCARD", guestsKey(id)]]));
    all = ids.flatMap((_, i) => {
      const raw = rows[i * 2];
      return typeof raw === "string" ? [{ ...(JSON.parse(raw) as Stored), guest_count: Number(rows[i * 2 + 1]) || 0 }] : [];
    });
  } else {
    all = Object.values(await loadFile()).map(({ guests, ...e }) => ({ ...e, guest_count: guests.length }));
  }
  return all.filter((e) => e.public);
}

/** Free events (public and private) this account hosts or joined; `going` marks the joined ones. */
// shortcut: scans every free event like listPublicFreeEvents; add a per-account index past a few hundred events.
export async function freeEventsOf(account: string): Promise<(FreeEvent & { going: boolean })[]> {
  let all: (FreeEvent & { going: boolean })[];
  if (usesRedis()) {
    const ids = await redis<string[]>(["SMEMBERS", INDEX]);
    const rows = await pipeline<string | number | null>(ids.flatMap((id) => [["GET", key(id)], ["SCARD", guestsKey(id)], ["SISMEMBER", guestsKey(id), account]]));
    all = ids.flatMap((_, i) => {
      const raw = rows[i * 3];
      return typeof raw === "string" ? [{ ...(JSON.parse(raw) as Stored), guest_count: Number(rows[i * 3 + 1]) || 0, going: Number(rows[i * 3 + 2]) === 1 }] : [];
    });
  } else {
    all = Object.values(await loadFile()).map(({ guests, ...e }) => ({ ...e, guest_count: guests.length, going: guests.includes(account) }));
  }
  return all.filter((e) => e.going || e.host === account);
}

/** Adds or removes a guest. Past events stay open so guests can add themselves after the fact. Returns an error message, or null on success. */
export async function setFreeGuest(id: string, account: string, going: boolean): Promise<string | null> {
  if (usesRedis()) {
    const [raw, count, member] = await pipeline<unknown>([["GET", key(id)], ["SCARD", guestsKey(id)], ["SISMEMBER", guestsKey(id), account]]);
    if (typeof raw !== "string") return "Event not found";
    const event = JSON.parse(raw) as Stored;
    if (!going) {
      await redis(["SREM", guestsKey(id), account]);
      return null;
    }
    if (Number(member)) return null;
    // shortcut: count-then-add can overshoot capacity by a few under simultaneous joins; use a Lua script if that matters.
    if (Number(count) >= event.capacity) return "This event is full";
    await redis(["SADD", guestsKey(id), account]);
    return null;
  }
  return updateFile((store) => {
    const event = store[id];
    if (!event) return "Event not found";
    if (!going) {
      event.guests = event.guests.filter((a) => a !== account);
      return null;
    }
    if (event.guests.includes(account)) return null;
    if (event.guests.length >= event.capacity) return "This event is full";
    event.guests.push(account);
    return null;
  });
}

/** Host-only: list the event in the public feed or keep it link-only. Returns an error message, or null. */
export async function setFreeEventPublic(id: string, host: string, listed: boolean): Promise<string | null> {
  if (usesRedis()) {
    const raw = await redis<string | null>(["GET", key(id)]);
    if (typeof raw !== "string") return "Event not found";
    const event = JSON.parse(raw) as Stored;
    if (event.host !== host) return "Only the host can change this";
    // shortcut: read-modify-write; a host saving twice at the same moment keeps the last write, which is fine here.
    await redis(["SET", key(id), JSON.stringify({ ...event, public: listed })]);
    return null;
  }
  return updateFile((store) => {
    const event = store[id];
    if (!event) return "Event not found";
    if (event.host !== host) return "Only the host can change this";
    event.public = listed;
    return null;
  });
}
