// Shared by the browser and the server: the rules for a door team list.

export const MAX_COHOSTS = 10;

// NEAR account ids: 2–64 chars of lowercase letters, digits and - _ . separators.
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Splits "alice.near, bob.near" into a list. */
export const splitCohosts = (text: string): string[] => text.split(/[\s,]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);

/** A clean, de-duplicated list, or null when it is not a valid door team. */
export function normalizeCohosts(value: unknown, host?: string): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const account = raw.trim().toLowerCase();
    if (!ACCOUNT_ID.test(account)) return null;
    if (account !== host && !out.includes(account)) out.push(account);
  }
  return out.length <= MAX_COHOSTS ? out : null;
}

/** Why a typed door team can't be saved, or null if it can. */
export function cohostsProblem(text: string): string | null {
  const list = splitCohosts(text);
  if (list.length > MAX_COHOSTS) return `Up to ${MAX_COHOSTS} people can be on the door team.`;
  const bad = list.find((a) => !ACCOUNT_ID.test(a));
  return bad ? `${bad.slice(0, 40)} is not a NEAR account or 0x address.` : null;
}
