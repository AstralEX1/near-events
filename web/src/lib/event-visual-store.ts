// Theme IDs and seeds are public presentation metadata, stored off-chain.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";
import { validEventVisual, type EventVisualConfig } from "./event-visuals";

const key = (eventId: number) => `event-visual:${EVENTS_CONTRACT}:${eventId}`;
const redisUrl = () => process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const redisToken = () => process.env.UPSTASH_REDIS_REST_TOKEN;

function usesRedis(): boolean {
  const url = redisUrl();
  const token = redisToken();
  if (url && token) return true;
  if (process.env.VERCEL || url || token) throw new Error("Event visual storage is not configured");
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
  if (!response.ok || json.error) throw new Error("Event visual storage request failed");
  return json.result as T;
}

const FILE = path.join(process.cwd(), ".data", "event-visuals.json");
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<Record<string, EventVisualConfig>> {
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, visual]) => validEventVisual(visual))) as Record<string, EventVisualConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile(fn: (store: Record<string, EventVisualConfig>) => void): Promise<void> {
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

export async function getEventVisuals(eventIds: number[]): Promise<Record<string, EventVisualConfig>> {
  if (!eventIds.length) return {};
  if (usesRedis()) {
    const values = await redis<(string | null)[]>(["MGET", ...eventIds.map(key)]);
    const out: Record<string, EventVisualConfig> = {};
    eventIds.forEach((id, index) => {
      try {
        const value = values[index] ? JSON.parse(values[index]!) : null;
        if (validEventVisual(value)) out[String(id)] = { themeId: value.themeId, seed: value.seed >>> 0 };
      } catch {}
    });
    return out;
  }
  const store = await loadFile();
  const out: Record<string, EventVisualConfig> = {};
  for (const id of eventIds) {
    const visual = store[key(id)];
    if (visual) out[String(id)] = visual;
  }
  return out;
}

export async function saveEventVisual(eventId: number, visual: EventVisualConfig): Promise<void> {
  const safeVisual = { themeId: visual.themeId, seed: visual.seed >>> 0 };
  const id = key(eventId);
  if (usesRedis()) {
    await redis(["SET", id, JSON.stringify(safeVisual)]);
    return;
  }
  await updateFile((store) => void (store[id] = safeVisual));
}
