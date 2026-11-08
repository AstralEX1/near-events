// The door team (co-hosts) of each event. They may check guests in; only the
// host can close or cancel, and that is enforced by the contract. The list
// lives on our server, next to check-ins: Upstash Redis when configured
// (needed on Vercel), otherwise web/.data/cohosts.json for local runs.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";
import { normalizeCohosts } from "./cohostsShared";

const key = (eventId: number) => `cohosts:${EVENTS_CONTRACT}:${eventId}`;
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

function usesRedis(): boolean {
  const url = redisUrl();
  const token = redisToken();
  if (url && token) return true;
  if (process.env.VERCEL || url || token) throw new Error("Door team storage is not configured");
  return false;
}

async function redis<T>(command: (string | number)[]): Promise<T> {
  const response = await fetch(redisUrl()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error("Door team storage request failed");
  return json.result as T;
}

const FILE = path.join(process.cwd(), ".data", "cohosts.json");
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<Record<string, string[]>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile(fn: (store: Record<string, string[]>) => void): Promise<void> {
  const run = lock.then(async () => {
    const store = await loadFile();
    fn(store);
    await mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2));
    await rename(temp, FILE);
  });
  lock = run.catch(() => {});
  return run;
}

const parse = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    return normalizeCohosts(JSON.parse(value)) ?? [];
  } catch {
    return [];
  }
};

/** Door team of each event, by event id. Events without one get []. */
export async function getCohostsMany(eventIds: number[]): Promise<Record<number, string[]>> {
  const out: Record<number, string[]> = {};
  if (eventIds.length === 0) return out;
  if (usesRedis()) {
    const values = await redis<(string | null)[]>(["MGET", ...eventIds.map(key)]);
    eventIds.forEach((id, i) => (out[id] = parse(values[i])));
    return out;
  }
  const store = await loadFile();
  for (const id of eventIds) out[id] = store[key(id)] ?? [];
  return out;
}

export async function getCohosts(eventId: number): Promise<string[]> {
  return (await getCohostsMany([eventId]))[eventId] ?? [];
}

/** Replaces the door team. An empty list removes it. */
export async function saveCohosts(eventId: number, cohosts: string[]): Promise<void> {
  const id = key(eventId);
  if (usesRedis()) {
    await redis(cohosts.length ? ["SET", id, JSON.stringify(cohosts)] : ["DEL", id]);
    return;
  }
  await updateFile((store) => {
    if (cohosts.length) store[id] = cohosts;
    else delete store[id];
  });
}
