import { rateLimited } from "@/lib/ratelimit";
import { getCohostsMany, saveCohosts } from "@/lib/cohosts";
import { normalizeCohosts } from "@/lib/cohostsShared";
import { events } from "@/lib/near";
import { readStaffToken } from "@/lib/staff";

// The door team of an event, kept on this server (see lib/cohosts.ts).
// GET ?e=<id> → { cohosts: [...] }, or ?ids=1,2,3 → { cohosts: { "1": [...] } }. Public, like the event page.
// POST { eventId, cohosts } with "Authorization: Bearer <staff token>". Host only.
export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const params = new URL(req.url).searchParams;
  const one = params.get("e");
  const ids = (one ?? params.get("ids") ?? "").split(",").filter(Boolean).map(Number);
  if (ids.length === 0 || ids.length > 100 || !ids.every((id) => Number.isInteger(id) && id >= 0)) {
    return Response.json({ error: "Bad event id" }, { status: 400 });
  }
  try {
    const all = await getCohostsMany(ids);
    return Response.json({ cohosts: one ? all[ids[0]] ?? [] : all });
  } catch {
    return Response.json({ error: "The door team is temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to change the door team" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { eventId?: number; cohosts?: unknown };
  if (!Number.isInteger(body.eventId) || (body.eventId ?? -1) < 0) return Response.json({ error: "Bad event id" }, { status: 400 });
  try {
    const event = await events.get(body.eventId!);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    if (event.host !== accountId) return Response.json({ error: "Only the event host can change the door team" }, { status: 403 });
    const cohosts = normalizeCohosts(body.cohosts, event.host);
    if (!cohosts) return Response.json({ error: "Use up to 10 NEAR accounts or 0x addresses" }, { status: 400 });
    await saveCohosts(body.eventId!, cohosts);
    return Response.json({ ok: true, cohosts });
  } catch {
    return Response.json({ error: "Could not save the door team" }, { status: 503 });
  }
}
