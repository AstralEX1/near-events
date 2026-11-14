// Moments (photos from a past event) live next to event details: an Upstash Redis
// list per event when hosted, an ignored JSON file under web/.data in development.
// The photos themselves are stored as covers (lib/covers.ts).
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVENTS_CONTRACT } from "./config";
import { redis, usesRedis } from "./eventDetails";
import { events } from "./near";
import { hostAccounts } from "./daoHost";
import { getCohosts } from "./cohosts";
import { getFreeEvent } from "./freeEvents";
import { isFreeEventId } from "./freeEventsShared";
import { MAX_MOMENTS, mayRemove, type Moment } from "./momentsShared";

/** `e=<on-chain id>` or `f=<free event id>`, as the event pages' URLs. */
export type Scope = { kind: "e"; id: number } | { kind: "f"; id: string };

export function parseScope(q: URLSearchParams): Scope | null {
  const e = q.get("e");
  const f = q.get("f");
  if (e !== null && /^\d{1,9}$/.test(e)) return { kind: "e", id: Number(e) };
  if (f !== null && isFreeEventId(f)) return { kind: "f", id: f };
  return null;
}

/** The account's place at the event; null when there is no such event. `host` includes the door team. */
export async function roles(scope: Scope, account: string) {
  if (scope.kind === "f") {
    const e = await getFreeEvent(scope.id);
    if (!e) return null;
    return { ended: e.ends_at < Date.now(), host: e.host === account, guest: (e.guests ?? []).includes(account) };
  }
  const e = await events.get(scope.id);
  if (!e) return null;
  const [team, door, status] = await Promise.all([hostAccounts(e.host), getCohosts(scope.id), events.guestStatus(scope.id, account)]);
  return { ended: e.metadata.ends_at < Date.now(), host: team.includes(account) || door.includes(account), guest: !!status };
}

const key = (s: Scope) => `moments:${EVENTS_CONTRACT}:${s.kind}:${s.id}`;

// ---------------------------------------------------------------- local file

const FILE = path.join(process.cwd(), ".data", "moments.json");
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<Record<string, Moment[]>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function updateFile<T>(fn: (store: Record<string, Moment[]>) => T): Promise<T> {
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

const raw = (s: Scope) => redis<string[]>(["LRANGE", key(s), 0, -1]);

/** Oldest first, as added. */
export async function listMoments(s: Scope): Promise<Moment[]> {
  if (usesRedis()) return (await raw(s)).map((v) => JSON.parse(v) as Moment);
  return (await loadFile())[key(s)] ?? [];
}

/** Adds the photo unless the event already has it; returns a problem when the event is full. */
export async function addMoment(s: Scope, m: Moment): Promise<string | null> {
  const full = "This event has as many photos as it can hold";
  if (!usesRedis()) {
    return updateFile((store) => {
      const list = (store[key(s)] ??= []);
      if (list.some((x) => x.id === m.id)) return null;
      if (list.length >= MAX_MOMENTS) return full;
      list.push(m);
      return null;
    });
  }
  const list = await listMoments(s);
  if (list.some((x) => x.id === m.id)) return null;
  // shortcut: two uploads at the same moment can pass this check together; fine for a soft cap.
  if (list.length >= MAX_MOMENTS) return full;
  await redis(["RPUSH", key(s), JSON.stringify(m)]);
  return null;
}

// shortcut: removes the photo from the event, not its bytes; the hash URL keeps working for anyone who saved it.
export async function removeMoment(s: Scope, id: string, account: string, host: boolean): Promise<string | null> {
  const denied = "Only the person who added this photo or the host can remove it";
  if (!usesRedis()) {
    return updateFile((store) => {
      const m = store[key(s)]?.find((x) => x.id === id);
      if (!m) return "Photo not found";
      if (!mayRemove(m, account, host)) return denied;
      store[key(s)] = store[key(s)].filter((x) => x.id !== id);
      return null;
    });
  }
  const value = (await raw(s)).find((v) => (JSON.parse(v) as Moment).id === id);
  if (!value) return "Photo not found";
  if (!mayRemove(JSON.parse(value) as Moment, account, host)) return denied;
  await redis(["LREM", key(s), 1, value]);
  return null;
}
