// User profiles on our server: Upstash Redis when hosted, an ignored JSON file under
// web/.data in local development. Same pattern as eventDetails.ts. Profiles belong to
// the NEAR account, not to an escrow, so keys are not contract-scoped; mainnet keys get
// their own prefix so testnet usernames never block mainnet ones in a shared database.
// Linked wallets (an EVM and a NEAR wallet of one person) share the profile of the
// wallet it lives under; see `linkPlan`.
import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NETWORK } from "./config";
import { redis, usesRedis } from "./eventDetails";
import { linkPlan, type Profile } from "./profilesShared";

const NS = NETWORK === "mainnet" ? "mainnet:" : "";
const key = (account: string) => `${NS}profile:${account}`;
const usernameKey = (username: string) => `${NS}profile-username:${username}`;
/** A linked wallet → the wallet its profile lives under. */
const linkKey = (account: string) => `${NS}profile-link:${account}`;
/** The wallets linked to a profile (a set), keyed by the profile's own wallet. */
const walletsKey = (owner: string) => `${NS}profile-wallets:${owner}`;

const FILE = path.join(process.cwd(), ".data", "profiles.json");
type FileStore = { profiles: Record<string, Profile>; usernames: Record<string, string>; links?: Record<string, string> };
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

/** The wallet each account's profile lives under: itself unless it is linked. */
async function owners(accounts: string[]): Promise<string[]> {
  if (usesRedis()) {
    const rows = await redis<(string | null)[]>(["MGET", ...accounts.map(linkKey)]);
    return accounts.map((a, i) => rows[i] ?? a);
  }
  const { links = {} } = await loadFile();
  return accounts.map((a) => links[a] ?? a);
}

/** Profiles stored under exactly these accounts. */
async function ownProfiles(accounts: string[]): Promise<Record<string, Profile>> {
  if (usesRedis()) {
    const rows = await redis<(string | null)[]>(["MGET", ...accounts.map(key)]);
    return Object.fromEntries(accounts.flatMap((a, i) => (rows[i] ? [[a, JSON.parse(rows[i]!) as Profile]] : [])));
  }
  const { profiles } = await loadFile();
  return Object.fromEntries(accounts.flatMap((a) => (profiles[a] ? [[a, profiles[a]]] : [])));
}

/** Profiles of the accounts that have one; a linked wallet gets its profile's. */
export async function getProfiles(accounts: string[]): Promise<Record<string, Profile>> {
  if (!accounts.length) return {};
  const of = await owners(accounts);
  const found = await ownProfiles([...new Set(of)]);
  return Object.fromEntries(accounts.flatMap((a, i) => (found[of[i]] ? [[a, found[of[i]]]] : [])));
}

/** The account's profile wallets: the one it lives under first, then the linked ones. */
export async function walletsOf(account: string): Promise<string[]> {
  const [owner] = await owners([account]);
  if (usesRedis()) return [owner, ...(await redis<string[]>(["SMEMBERS", walletsKey(owner)])).sort()];
  const { links = {} } = await loadFile();
  return [owner, ...Object.keys(links).filter((a) => links[a] === owner).sort()];
}

/** Links two wallets the caller proved (`a` is the one signed in). Returns an error message, or null. */
export async function linkWallets(a: string, b: string): Promise<string | null> {
  const [wa, wb] = await Promise.all([walletsOf(a), walletsOf(b)]);
  const found = await ownProfiles([wa[0], wb[0]]);
  const plan = linkPlan({ wallets: wa, hasProfile: !!found[wa[0]] }, { wallets: wb, hasProfile: !!found[wb[0]] });
  if ("error" in plan) return plan.error;
  if (usesRedis()) {
    // NX: two links racing can't put one wallet into two profiles.
    if (!(await redis<string | null>(["SET", linkKey(plan.join), plan.primary, "NX"]))) return "This wallet was just linked elsewhere. Reload and try again.";
    await redis(["SADD", walletsKey(plan.primary), plan.join]);
    return null;
  }
  return updateFile((store) => {
    (store.links ??= {})[plan.join] = plan.primary;
    return null;
  });
}

/** Unlinks a wallet from its profile; it gets its own (or no) profile back. The profile's own wallet stays. */
export async function unlinkWallet(account: string): Promise<void> {
  const [owner] = await owners([account]);
  if (owner === account) return;
  if (usesRedis()) {
    await redis(["DEL", linkKey(account)]);
    await redis(["SREM", walletsKey(owner), account]);
    return;
  }
  await updateFile((store) => {
    delete store.links?.[account];
  });
}

/** Saves a cleaned profile (a linked wallet saves its profile's). Returns an error message (username taken), or null on success. */
export async function saveProfile(signedIn: string, profile: Profile): Promise<string | null> {
  const TAKEN = "This username is taken";
  const [account] = await owners([signedIn]);
  if (usesRedis()) {
    const old = (await ownProfiles([account]))[account];
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
