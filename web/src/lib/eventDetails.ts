// Public event presentation details are stored outside the escrow contract.
// Hosted deployments use the same Upstash REST database as door check-ins;
// local development uses an ignored JSON file under web/.data.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";
import type { EventDetails } from "./eventImport";

const key = (eventId: number) => `event-details:${EVENTS_CONTRACT}:${eventId}`;
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

export function usesRedis(): boolean {
  const url = redisUrl();
  const token = redisToken();
  if (url && token) return true;
  if (process.env.VERCEL || url || token) throw new Error("Event detail storage is not configured");
  return false;
}

export async function redis<T>(command: (string | number)[]): Promise<T> {
  const response = await fetch(redisUrl()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error("Event detail storage request failed");
  return json.result as T;
}

const FILE = path.join(process.cwd(), ".data", "event-details.json");
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<Record<string, EventDetails>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile(fn: (store: Record<string, EventDetails>) => void): Promise<void> {
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

export async function getEventDetails(eventId: number): Promise<EventDetails | null> {
  const id = key(eventId);
  if (usesRedis()) {
    const value = await redis<string | null>(["GET", id]);
    return value ? JSON.parse(value) as EventDetails : null;
  }
  return (await loadFile())[id] ?? null;
}

export async function saveEventDetails(eventId: number, details: EventDetails): Promise<void> {
  const id = key(eventId);
  if (usesRedis()) {
    await redis(["SET", id, JSON.stringify(details)]);
    return;
  }
  await updateFile((store) => void (store[id] = details));
}
