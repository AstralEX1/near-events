// Door check-ins live on our server until the host finalizes; then the list
// goes on-chain in one `finalize(event_id, attended)` call.
//
// Every mark and unmark is appended to a log that is never edited, and the API
// stops taking marks once the event is no longer Open (the list is published).
// The log is public: the dispute council reads it next to the host's list.
//
// Storage: Upstash Redis (REST) when UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN are set (needed on Vercel, whose disk is wiped),
// otherwise a JSON file in .data/ for local runs.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";

/** account → when they were checked in (ms) and who did it. */
export type CheckIns = Record<string, { at: number; by: string }>;
/** One door action, in order: `on` checked the guest in, `!on` unchecked them. */
export type CheckInEntry = { account: string; on: boolean; at: number; by: string };

/** Before the log: a plain map, still read for events checked in with it. */
const KEY = (eventId: number) => `checkins:${EVENTS_CONTRACT}:${eventId}`;
const LOG = (eventId: number) => `checkinlog:${EVENTS_CONTRACT}:${eventId}`;

// ---------------------------------------------------------------- redis

const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

function usesRedis(): boolean {
  const url = redisUrl();
  const token = redisToken();
  if (url && token) return true;
  if (process.env.VERCEL || url || token) throw new Error("Check-in storage is not configured");
  return false;
}

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(redisUrl()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error("Check-in storage request failed");
  return json.result as T;
}

// ----------------------------------------------------------------- file

const FILE = path.join(process.cwd(), ".data", "checkins.json");
let lock: Promise<unknown> = Promise.resolve();

type FileState = Record<string, CheckIns | CheckInEntry[]>;

async function loadFile(): Promise<FileState> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile<T>(fn: (s: FileState) => T): Promise<T> {
  const run = lock.then(async () => {
    const s = await loadFile();
    const out = fn(s);
    await mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(s, null, 2));
    await rename(temp, FILE);
    return out;
  });
  lock = run.catch(() => {});
  return run;
}

// ------------------------------------------------------------------ api

/** Every mark and unmark of the event, oldest first. */
export async function checkInLog(eventId: number): Promise<CheckInEntry[]> {
  if (usesRedis()) return (await redis<string[]>(["LRANGE", LOG(eventId), 0, -1])).map((x) => JSON.parse(x));
  return ((await loadFile())[LOG(eventId)] as CheckInEntry[] | undefined) ?? [];
}

export async function listCheckIns(eventId: number): Promise<CheckIns> {
  // Marks made before the log (a plain map) count first, so a mid-event deploy drops nobody.
  const out: CheckIns = {};
  if (usesRedis()) {
    const flat = await redis<string[]>(["HGETALL", KEY(eventId)]);
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
  } else {
    Object.assign(out, ((await loadFile())[KEY(eventId)] as CheckIns | undefined) ?? {});
  }
  for (const x of await checkInLog(eventId)) {
    if (x.on) out[x.account] ??= { at: x.at, by: x.by };
    else delete out[x.account];
  }
  return out;
}

/** Marks (`on`) or unmarks a guest by appending to the log. Repeating the current state adds nothing. */
export async function setCheckIn(eventId: number, account: string, on: boolean, by: string): Promise<void> {
  if (!!(await listCheckIns(eventId))[account] === on) return;
  const entry: CheckInEntry = { account, on, at: Date.now(), by };
  if (usesRedis()) {
    await redis(["RPUSH", LOG(eventId), JSON.stringify(entry)]);
    return;
  }
  await updateFile((s) => {
    ((s[LOG(eventId)] ??= []) as CheckInEntry[]).push(entry);
  });
}

/**
 * While an event is open, shows the server's check-ins as if they were on-chain:
 * checked-in guests get status "Attended" and `attended_count` counts them.
 * After finalize the contract's own numbers are used.
 */
export async function withCheckIns<E extends { id: number; status: string; attended_count: number }, G extends { account_id: string; status: string }>(
  e: E,
  guests: G[],
): Promise<{ e: E; guests: G[] }> {
  if (e.status !== "Open") return { e, guests };
  const marks = await listCheckIns(e.id);
  const out = guests.map((g) => (marks[g.account_id] ? { ...g, status: "Attended" } : g));
  return { e: { ...e, attended_count: out.filter((g) => g.status === "Attended").length }, guests: out };
}
