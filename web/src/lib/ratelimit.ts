// Local limits protect development and cheap routes. Paid routes share a
// quota across instances when Redis is configured.
const windows = new Map<string, { expires: number; count: number }>();

function address(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 128) || "local";
}

function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = windows.get(key);
  if (current && current.expires > now) {
    if (current.count >= max) return true;
    current.count++;
    return false;
  }
  if (windows.size >= 4096) {
    for (const [id, value] of windows) if (value.expires <= now) windows.delete(id);
    if (windows.size >= 4096) return true;
  }
  windows.set(key, { expires: now + windowMs, count: 1 });
  return false;
}

export function rateLimited(req: Request, max = 20, windowMs = 60_000) {
  return limited(`${new URL(req.url).pathname}:${address(req)}`, max, windowMs);
}

const quota = `
local n = tonumber(ARGV[1])
if #KEYS > n and redis.call('EXISTS', KEYS[n + 1]) == 1 then return 1 end
for i = 1, n do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[2 * i]) then return 1 end
end
for i = 1, n do
  if redis.call('INCR', KEYS[i]) == 1 then redis.call('EXPIRE', KEYS[i], ARGV[2 * i + 1]) end
end
if #KEYS > n then redis.call('SET', KEYS[n + 1], '1', 'EX', 600) end
return 0`;

export async function paidRequestLimited(req: Request, scope: string, account?: string, nonce?: string) {
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  const proxy = scope.startsWith("oneclick");
  const budget = proxy ? 120 : 30;
  const maxPerIp = proxy ? 30 : 8;
  if (!url || !token) {
    if (process.env.VERCEL || process.env.NEXT_PUBLIC_NETWORK === "mainnet") return true;
    if (rateLimited(req, maxPerIp) || limited(`paid:${scope}`, budget, 60_000)) return true;
    return !!nonce && limited(`nonce:${account}:${nonce}`, 1, 600_000);
  }
  const prefix = `near-me:${process.env.NEXT_PUBLIC_NETWORK ?? "testnet"}`;
  const keys = [`${prefix}:${proxy ? scope : "relayer"}:all`, `${prefix}:${scope}:ip:${address(req)}`];
  const limits = [budget, 60, maxPerIp, 60];
  if (!proxy) {
    keys.push(`${prefix}:relayer:daily`);
    limits.push(300, 86_400);
  }
  if (account) {
    keys.push(`${prefix}:${scope}:account:${account}`);
    limits.push(scope === "faucet" || scope === "fund" ? 1 : 5, 60);
  }
  const limitCount = keys.length;
  if (nonce) keys.push(`${prefix}:${scope}:nonce:${account}:${nonce}`);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["EVAL", quota, keys.length, ...keys, limitCount, ...limits]), signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    return !response.ok || (await response.json()).result !== 0;
  } catch {
    return true;
  }
}
