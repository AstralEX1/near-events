// User profiles on our server: Upstash Redis when hosted, an ignored JSON file under
// web/.data in local development. Same pattern as eventDetails.ts. Profiles belong to
// the NEAR account, not to an escrow, so keys are not contract-scoped.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redis, usesRedis } from "./eventDetails";
import type { Profile } from "./profilesShared";

const key = (account: string) => `profile:${account}`;
const nickKey = (nick: string) => `profile-nick:${nick}`;

const FILE = path.join(process.cwd(), ".data", "profiles.json");
type FileStore = { profiles: Record<string, Profile>; nicks: Record<string, string> };
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<FileStore> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {}, nicks: {} };
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

/** Profiles of the accounts that have one. */
export async function getProfiles(accounts: string[]): Promise<Record<string, Profile>> {
  if (!accounts.length) return {};
  if (usesRedis()) {
    const rows = await redis<(string | null)[]>(["MGET", ...accounts.map(key)]);
    return Object.fromEntries(accounts.flatMap((a, i) => (rows[i] ? [[a, JSON.parse(rows[i]!) as Profile]] : [])));
  }
  const { profiles } = await loadFile();
  return Object.fromEntries(accounts.flatMap((a) => (profiles[a] ? [[a, profiles[a]]] : [])));
}

/** Saves a cleaned profile. Returns an error message (nickname taken), or null on success. */
export async function saveProfile(account: string, profile: Profile): Promise<string | null> {
  const TAKEN = "This nickname is taken";
  if (usesRedis()) {
    const old = (await getProfiles([account]))[account];
    if (profile.nickname && profile.nickname !== old?.nickname) {
      // SET NX claims the nickname atomically, so two accounts can't both get it.
      const claimed = await redis<string | null>(["SET", nickKey(profile.nickname), account, "NX"]);
      if (!claimed && (await redis<string | null>(["GET", nickKey(profile.nickname)])) !== account) return TAKEN;
    }
    await redis(["SET", key(account), JSON.stringify(profile)]);
    if (old?.nickname && old.nickname !== profile.nickname) await redis(["DEL", nickKey(old.nickname)]);
    return null;
  }
  return updateFile((store) => {
    const owner = profile.nickname && store.nicks[profile.nickname];
    if (owner && owner !== account) return TAKEN;
    const old = store.profiles[account];
    if (old?.nickname && old.nickname !== profile.nickname) delete store.nicks[old.nickname];
    if (profile.nickname) store.nicks[profile.nickname] = account;
    store.profiles[account] = profile;
    return null;
  });
}
