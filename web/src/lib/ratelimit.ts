// Tiny in-memory limiter for relayer routes (per server instance). Enough to
// stop casual draining of the relayer's gas; not a substitute for real auth.
const hits = new Map<string, number[]>();

export function rateLimited(req: Request, max = 20, windowMs = 60_000): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > max;
}
