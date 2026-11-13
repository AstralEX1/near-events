// Events hosted by a Sputnik DAO: the members of its "council" role act as the
// host on this site (Manage, door team, check-in). Works on the server and in
// the browser.
import { view } from "./near";
import { councilOf, isDaoAccount, type Policy } from "./daoShared";

export { isDaoAccount };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; policy: Promise<Policy> }>();

/** The DAO's policy, cached for a few minutes. */
export function daoPolicy(dao: string): Promise<Policy> {
  const hit = cache.get(dao);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.policy;
  const policy = view<Policy>("get_policy", {}, dao).catch((e) => {
    cache.delete(dao);
    throw e;
  });
  cache.set(dao, { at: Date.now(), policy });
  return policy;
}

/** Who acts as the host of an event hosted by `host`: the council for a DAO, otherwise the host itself. */
export async function hostAccounts(host: string): Promise<string[]> {
  return isDaoAccount(host) ? councilOf(await daoPolicy(host)) : [host];
}
