// Display names for guests. On-chain registration is still the NEAR account;
// the name is only for the host guest list and door check-in.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";

export type GuestNames = Record<string, string>;

const KEY = (eventId: number) => `guest-names:${EVENTS_CONTRACT}:${eventId}`;
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

function usesRedis(): boolean {
  const url = redisUrl();
  const token = redisToken();
  if (url && token) return true;
  if (process.env.VERCEL || url || token) throw new Error("Guest name storage is not configured");
  return false;
}

async function redis<T>(command: (string | number)[]): Promise<T> {
  const res = await fetch(redisUrl()!, {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error("Guest name storage request failed");
  return json.result as T;
}

const FILE = path.join(process.cwd(), ".data", "guest-names.json");
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<Record<string, GuestNames>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile(fn: (store: Record<string, GuestNames>) => void): Promise<void> {
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

export async function getGuestNames(eventId: number): Promise<GuestNames> {
  const id = KEY(eventId);
  if (usesRedis()) {
    const value = await redis<string | null>(["GET", id]);
    return value ? (JSON.parse(value) as GuestNames) : {};
  }
  return (await loadFile())[id] ?? {};
}

export async function setGuestName(eventId: number, accountId: string, name: string): Promise<void> {
  const id = KEY(eventId);
  if (usesRedis()) {
    const current = await getGuestNames(eventId);
    current[accountId] = name;
    await redis(["SET", id, JSON.stringify(current)]);
    return;
  }
  await updateFile((store) => {
    const current = store[id] ?? {};
    current[accountId] = name;
    store[id] = current;
  });
}

/** Trimmed display name, or null if empty / too long. Max 80 UTF-8 bytes. */
export function cleanGuestName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || new TextEncoder().encode(name).length > 80) return null;
  return name;
}
