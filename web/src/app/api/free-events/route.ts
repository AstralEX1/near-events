import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { createFreeEvent, getFreeEvent, listPublicFreeEvents, setFreeEventPublic, setFreeGuest } from "@/lib/freeEvents";
import { freeEventProblem, isFreeEventId, type FreeEventInput } from "@/lib/freeEventsShared";

// GET            → public free events for the /events feed
// GET ?id=<id>   → one free event with its guest list
// POST {action:"create", event} | {action:"join"|"leave", id} | {action:"visibility", id, public}  (signed in)
export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const id = new URL(req.url).searchParams.get("id");
  try {
    if (id === null) return Response.json({ events: await listPublicFreeEvents() }, { headers: { "Cache-Control": "no-store" } });
    if (!isFreeEventId(id)) return Response.json({ error: "Bad event id" }, { status: 400 });
    const event = await getFreeEvent(id);
    return event ? Response.json({ event }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Event not found" }, { status: 404 });
  } catch {
    return Response.json({ error: "Events are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; event?: unknown; public?: unknown };
  try {
    if (body.action === "create") {
      const problem = freeEventProblem(body.event);
      if (problem) return Response.json({ error: problem }, { status: 400 });
      const e = body.event as FreeEventInput;
      const id = await createFreeEvent(accountId, {
        title: e.title.trim(),
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        capacity: e.capacity,
        location: e.location.trim(),
        description: e.description.trim(),
        cover_url: e.cover_url ? new URL(e.cover_url).href : null,
        visual: { themeId: e.visual.themeId, seed: e.visual.seed >>> 0 },
        public: e.public,
      });
      return Response.json({ id });
    }
    if ((body.action === "join" || body.action === "leave") && typeof body.id === "string" && isFreeEventId(body.id)) {
      const problem = await setFreeGuest(body.id, accountId, body.action === "join");
      return problem ? Response.json({ error: problem }, { status: problem === "Event not found" ? 404 : 409 }) : Response.json({ ok: true });
    }
    if (body.action === "visibility" && typeof body.id === "string" && isFreeEventId(body.id) && typeof body.public === "boolean") {
      const problem = await setFreeEventPublic(body.id, accountId, body.public);
      if (!problem) return Response.json({ ok: true });
      return Response.json({ error: problem }, { status: problem === "Event not found" ? 404 : 403 });
    }
    return Response.json({ error: "Bad request" }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not save. Try again." }, { status: 503 });
  }
}
