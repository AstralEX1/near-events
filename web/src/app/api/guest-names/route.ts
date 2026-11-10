import { rateLimited } from "@/lib/ratelimit";
import { cleanGuestName, getGuestNames, setGuestName } from "@/lib/guestNames";
import { events } from "@/lib/near";
import { readStaffToken } from "@/lib/staff";

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const eventId = Number(new URL(req.url).searchParams.get("e"));
  if (!Number.isInteger(eventId) || eventId < 0) return Response.json({ error: "Bad event id" }, { status: 400 });
  try {
    return Response.json({ names: await getGuestNames(eventId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Guest names are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to save your name" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { eventId?: number; name?: unknown };
  if (!Number.isInteger(body.eventId) || (body.eventId ?? -1) < 0) {
    return Response.json({ error: "Bad event id" }, { status: 400 });
  }
  const name = cleanGuestName(body.name);
  if (!name) return Response.json({ error: "Enter a name (up to 80 characters)." }, { status: 400 });

  try {
    const event = await events.get(body.eventId!);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    await setGuestName(body.eventId!, accountId, name);
    return Response.json({ ok: true, name });
  } catch {
    return Response.json({ error: "Could not save your name" }, { status: 503 });
  }
}
