// User profiles (avatar, nickname, name, social links). Off-chain only; shared by the browser and the API.

export const LINK_KINDS = ["x", "telegram", "instagram", "website"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface Profile {
  nickname: string;
  first_name: string;
  last_name: string;
  /** Path of an uploaded photo, `/api/covers/<sha256>`, or null. */
  avatar_url: string | null;
  /** Seed of a randomly generated avatar, used when there is no photo; null = generated from the account name. */
  avatar_seed?: number | null;
  /** Handles without "@" for x/telegram/instagram, a full http(s) URL for website. */
  links: Partial<Record<LinkKind, string>>;
}

export const EMPTY_PROFILE: Profile = { nickname: "", first_name: "", last_name: "", avatar_url: null, avatar_seed: null, links: {} };

const HOSTS: Record<Exclude<LinkKind, "website">, { hosts: string[]; handle: RegExp; url: string }> = {
  x: { hosts: ["x.com", "twitter.com"], handle: /^[A-Za-z0-9_]{1,15}$/, url: "https://x.com/" },
  telegram: { hosts: ["t.me", "telegram.me"], handle: /^[A-Za-z0-9_]{4,32}$/, url: "https://t.me/" },
  instagram: { hosts: ["instagram.com"], handle: /^[A-Za-z0-9_.]{1,30}$/, url: "https://instagram.com/" },
};

/** "@name", "name" or a profile URL on the right site → "name"; null when it isn't one. */
export function cleanHandle(kind: Exclude<LinkKind, "website">, value: string): string | null {
  const { hosts, handle } = HOSTS[kind];
  let v = value.trim();
  if (/^(https?:\/\/)?(www\.)?[a-z.]+\.[a-z]+\//i.test(v)) {
    try {
      const url = new URL(/^https?:/i.test(v) ? v : `https://${v}`);
      if (!hosts.includes(url.hostname.replace(/^www\./, ""))) return null;
      v = url.pathname.split("/")[1] ?? "";
    } catch {
      return null;
    }
  }
  v = v.replace(/^@/, "");
  return handle.test(v) ? v : null;
}

export function cleanWebsite(value: string): string | null {
  const v = value.trim();
  if (v.length > 300) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return ["http:", "https:"].includes(url.protocol) && url.hostname.includes(".") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** Where a saved link opens. */
export const linkUrl = (kind: LinkKind, value: string) => (kind === "website" ? value : HOSTS[kind].url + value);

export const isNickname = (v: string) => /^[a-z0-9_]{3,20}$/.test(v);
const AVATAR = /^\/api\/covers\/[0-9a-f]{64}$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** A clean profile ready to save, or the first problem to show. Runs on the server for every save. */
export function cleanProfile(value: unknown): { profile: Profile } | { error: string } {
  if (!value || typeof value !== "object") return { error: "Bad profile" };
  const p = value as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");
  const nickname = text(p.nickname).toLowerCase().replace(/^@/, "");
  if (nickname && !isNickname(nickname)) return { error: "Nickname: 3–20 letters, numbers or _" };
  const first_name = text(p.first_name);
  const last_name = text(p.last_name);
  if (bytes(first_name) > 60 || bytes(last_name) > 60) return { error: "Name is too long" };
  let avatar_url: string | null = null;
  if (p.avatar_url) {
    // Only our own uploads: an outside image URL would let a profile track whoever views it.
    const path = typeof p.avatar_url === "string" ? p.avatar_url.replace(/^https?:\/\/[^/]+/i, "") : "";
    if (!AVATAR.test(path)) return { error: "Bad photo" };
    avatar_url = path;
  }
  const avatar_seed = p.avatar_seed == null ? null : p.avatar_seed;
  if (avatar_seed !== null && !(Number.isInteger(avatar_seed) && (avatar_seed as number) >= 0 && (avatar_seed as number) <= 0xffffffff)) return { error: "Bad avatar" };
  const links: Profile["links"] = {};
  const raw = (p.links && typeof p.links === "object" ? p.links : {}) as Record<string, unknown>;
  for (const kind of LINK_KINDS) {
    const v = text(raw[kind]);
    if (!v) continue;
    const clean = kind === "website" ? cleanWebsite(v) : cleanHandle(kind, v);
    if (!clean) return { error: `Check the ${kind === "x" ? "X" : kind[0].toUpperCase() + kind.slice(1)} link` };
    links[kind] = clean;
  }
  return { profile: { nickname, first_name, last_name, avatar_url, avatar_seed: avatar_seed as number | null, links } };
}

/** "First Last", else "@nickname", else null. */
export function displayName(p: Profile | null | undefined): string | null {
  if (!p) return null;
  return `${p.first_name} ${p.last_name}`.trim() || (p.nickname ? `@${p.nickname}` : null);
}
