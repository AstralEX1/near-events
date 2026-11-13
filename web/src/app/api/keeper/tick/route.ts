import { timingSafeEqual } from "node:crypto";
import { keeperLock, pendingEvents, planKeeper, runKeeper } from "@/lib/keeper";

const authorized = (header: string | null, secret: string) => {
  const [got, want] = [Buffer.from(header ?? ""), Buffer.from(`Bearer ${secret}`)];
  return got.length === want.length && timingSafeEqual(got, want);
};

// The scheduled keeper (SPEC D3): every ~10 minutes an Upstash QStash schedule
// (or Vercel Cron) calls this with `Authorization: Bearer $CRON_SECRET`. It
// settles or refunds Deposit events that are due and opens the DAO proposal
// pair for each new dispute. Anyone can still call `settle` / `refund` on the
// escrow directly, so the money never depends on this route.
async function tick(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "The keeper is not configured (CRON_SECRET, 32+ characters)" }, { status: 503 });
  if (!authorized(req.headers.get("authorization"), secret)) return Response.json({ error: "Forbidden" }, { status: 403 });
  if (!(await keeperLock())) return Response.json({ skipped: "another tick is running" });
  try {
    const plan = await planKeeper(await pendingEvents());
    const results = await runKeeper(plan);
    if (plan.lowDaos.length) console.warn("keeper: DAO balance is low", plan.lowDaos);
    const failed = results.filter((r) => !r.ok);
    if (failed.length) console.warn("keeper: failed actions", failed);
    return Response.json({ results, lowDaos: plan.lowDaos });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export const GET = tick;
export const POST = tick;
