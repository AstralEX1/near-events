import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { createFreeEvent, decideFreeRequest, freeEventsOf, getFreeEvent, listPublicFreeEvents, setFreeEventPublic, setFreeGuest } from "@/lib/freeEvents";
import { freeEventProblem, isFreeEventId, type FreeEventInput } from "@/lib/freeEventsShared";

// GET            → public free events for the /events feed
// GET ?id=<id>   → one free event with its guest list; with a token, the host also gets pending
//                  requests and a guest learns whether their own request is pending
// GET ?attended=<account> → { count } of ended free events the account joined
// GET ?mine=1    → free events the signed-in account hosts or joined (bearer token)
// POST {action:"create", event} | {action:"join"|"leave", id} | {action:"visibility", id, public}
//      | {action:"approve"|"decline", id, guest}  (signed in)
const viewer = (req: Request) => {
  try {
    return readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {
    return null;
  }
};

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const params = new URL(req.url).searchParams;
  const id = params.get("id");
  try {
    const attended = params.get("attended");
    if (attended !== null) {
      const now = Date.now();
      return Response.json({ count: (await freeEventsOf(attended)).filter((e) => e.going && e.ends_at < now).length }, { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("mine") !== null) {
      const accountId = viewer(req);
      if (!accountId) return Response.json({ error: "Sign in again" }, { status: 401 });
      return Response.json({ events: await freeEventsOf(accountId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (id === null) return Response.json({ events: await listPublicFreeEvents() }, { headers: { "Cache-Control": "no-store" } });
    if (!isFreeEventId(id)) return Response.json({ error: "Bad event id" }, { status: 400 });
    const event = await getFreeEvent(id);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    const me = viewer(req);
    const { requests = [], ...rest } = event;
    const view = me === event.host ? { ...rest, requests } : { ...rest, requested: !!me && requests.includes(me) };
    return Response.json({ event: view }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Events are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const accountId = viewer(req);
  if (!accountId) return Response.json({ error: "Sign in again" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; event?: unknown; public?: unknown; guest?: unknown };
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
        approval: e.approval === true,
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
    if ((body.action === "approve" || body.action === "decline") && typeof body.id === "string" && isFreeEventId(body.id) && typeof body.guest === "string" && body.guest.length <= 128) {
      const problem = await decideFreeRequest(body.id, accountId, body.guest, body.action === "approve");
      if (!problem) return Response.json({ ok: true });
      const status = problem === "Event not found" ? 404 : problem === "Only the host can change this" ? 403 : 409;
      return Response.json({ error: problem }, { status });
    }
    return Response.json({ error: "Bad request" }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not save. Try again." }, { status: 503 });
  }
}
