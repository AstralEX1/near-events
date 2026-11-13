import { rateLimited } from "@/lib/ratelimit";
import { getEventVisuals, saveEventVisual } from "@/lib/event-visual-store";
import { validEventVisual } from "@/lib/event-visuals";
import { events } from "@/lib/near";
import { hostAccounts } from "@/lib/daoHost";
import { readStaffToken } from "@/lib/staff";

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw.split(",").filter(Boolean).map(Number);
  if (ids.length > 50 || ids.some((id) => !Number.isInteger(id) || id < 0)) {
    return Response.json({ error: "Bad event ids" }, { status: 400 });
  }
  try {
    return Response.json({ visuals: await getEventVisuals([...new Set(ids)]) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Event visuals are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to save event visuals" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { eventId?: number; visual?: unknown };
  if (!Number.isInteger(body.eventId) || (body.eventId ?? -1) < 0 || !validEventVisual(body.visual)) {
    return Response.json({ error: "Bad event visual" }, { status: 400 });
  }
  try {
    const event = await events.get(body.eventId!);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    if (!(await hostAccounts(event.host)).includes(accountId)) return Response.json({ error: "Only the event host can save event visuals" }, { status: 403 });
    await saveEventVisual(body.eventId!, { themeId: body.visual.themeId, seed: body.visual.seed >>> 0 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not save event visuals" }, { status: 503 });
  }
}
