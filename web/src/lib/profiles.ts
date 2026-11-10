// User profiles on our server: Upstash Redis when hosted, an ignored JSON file under
// web/.data in local development. Same pattern as eventDetails.ts. Profiles belong to
// the NEAR account, not to an escrow, so keys are not contract-scoped; mainnet keys get
// their own prefix so testnet usernames never block mainnet ones in a shared database.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NETWORK } from "./config";
import { redis, usesRedis } from "./eventDetails";
import type { Profile } from "./profilesShared";

const NS = NETWORK === "mainnet" ? "mainnet:" : "";
const key = (account: string) => `${NS}profile:${account}`;
const usernameKey = (username: string) => `${NS}profile-username:${username}`;

const FILE = path.join(process.cwd(), ".data", "profiles.json");
type FileStore = { profiles: Record<string, Profile>; usernames: Record<string, string> };
let lock: Promise<unknown> = Promise.resolve();

async function loadFile(): Promise<FileStore> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { profiles: {}, usernames: {} };
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

/** Saves a cleaned profile. Returns an error message (username taken), or null on success. */
export async function saveProfile(account: string, profile: Profile): Promise<string | null> {
  const TAKEN = "This username is taken";
  if (usesRedis()) {
    const old = (await getProfiles([account]))[account];
    if (profile.username && profile.username !== old?.username) {
      // SET NX claims the username atomically, so two accounts can't both get it.
      const claimed = await redis<string | null>(["SET", usernameKey(profile.username), account, "NX"]);
      if (!claimed && (await redis<string | null>(["GET", usernameKey(profile.username)])) !== account) return TAKEN;
    }
    await redis(["SET", key(account), JSON.stringify(profile)]);
    if (old?.username && old.username !== profile.username) await redis(["DEL", usernameKey(old.username)]);
    return null;
  }
  return updateFile((store) => {
    const owner = profile.username && store.usernames[profile.username];
    if (owner && owner !== account) return TAKEN;
    const old = store.profiles[account];
    if (old?.username && old.username !== profile.username) delete store.usernames[old.username];
    if (profile.username) store.usernames[profile.username] = account;
    store.profiles[account] = profile;
    return null;
  });
}
