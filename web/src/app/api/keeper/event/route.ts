import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { events } from "@/lib/near";
import { keeperLock, planKeeper, runKeeper } from "@/lib/keeper";

// The "Settle" button, the event page's check when a deadline has passed, and
// the nudge right after a dispute: the keeper for one event. It only sends what
// the escrow's views say is due (`settle`, `refund`) or one missing DAO proposal
// pair, under a per-event lock, so callers cannot make the relayer pay much.
export async function POST(req: Request) {
  if (rateLimited(req, 6)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let eventId: number;
  try {
    eventId = (await req.json()).eventId;
    if (!Number.isSafeInteger(eventId) || eventId < 0) throw new Error();
  } catch {
    return Response.json({ error: "Pass { eventId }" }, { status: 400 });
  }
  try {
    const event = await events.get(eventId);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    const plan = await planKeeper([event]);
    if (!plan.actions.length) return Response.json({ results: [] });
    // Two clicks (or a click and the cron) would send the same proposals twice.
    if (!(await keeperLock(`event:${eventId}`, 60))) return Response.json({ results: [], busy: true });
    if (await paidRequestLimited(req, "keeper")) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
    // At most one proposal pair per call: the cron tick opens the rest.
    return Response.json({ results: await runKeeper(plan, 2) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
