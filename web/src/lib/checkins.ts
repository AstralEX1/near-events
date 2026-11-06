// Door check-ins live on our server until the host finalizes; then the list
// goes on-chain in one `finalize(event_id, attended)` call.
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

const KEY = (eventId: number) => `checkins:${EVENTS_CONTRACT}:${eventId}`;

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

async function loadFile(): Promise<Record<string, CheckIns>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile<T>(fn: (s: Record<string, CheckIns>) => T): Promise<T> {
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

export async function listCheckIns(eventId: number): Promise<CheckIns> {
  if (usesRedis()) {
    const flat = await redis<string[]>(["HGETALL", KEY(eventId)]);
    const out: CheckIns = {};
    for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
    return out;
  }
  return (await loadFile())[KEY(eventId)] ?? {};
}

/** Marks (`on`) or unmarks a guest. Safe to repeat. */
export async function setCheckIn(eventId: number, account: string, on: boolean, by: string): Promise<void> {
  if (usesRedis()) {
    if (on) await redis(["HSET", KEY(eventId), account, JSON.stringify({ at: Date.now(), by })]);
    else await redis(["HDEL", KEY(eventId), account]);
    return;
  }
  await updateFile((s) => {
    const list = (s[KEY(eventId)] ??= {});
    if (on) list[account] ??= { at: Date.now(), by };
    else delete list[account];
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
