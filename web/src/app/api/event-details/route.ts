import { rateLimited } from "@/lib/ratelimit";
import { getEventDetails, getPrivateEventIds, saveEventDetails } from "@/lib/eventDetails";
import { locationProblem, type EventDetails } from "@/lib/eventImport";
import { events } from "@/lib/near";
import { readStaffToken } from "@/lib/staff";

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const params = new URL(req.url).searchParams;
  // ?private=1 → ids of link-only events, for public listings to filter out.
  if (params.has("private")) {
    try {
      return Response.json({ ids: await getPrivateEventIds() }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "Event details are temporarily unavailable" }, { status: 503 });
    }
  }
  const eventId = Number(params.get("e"));
  if (!Number.isInteger(eventId) || eventId < 0) return Response.json({ error: "Bad event id" }, { status: 400 });
  try {
    return Response.json({ details: await getEventDetails(eventId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Event details are temporarily unavailable" }, { status: 503 });
  }
}

function safeCoverUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validDetails(value: unknown): value is EventDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  return typeof details.location === "string" && new TextEncoder().encode(details.location).length <= 1000
    && typeof details.description === "string" && new TextEncoder().encode(details.description).length <= 10_000
    && (details.cover_url === null || safeCoverUrl(details.cover_url))
    && (details.public === undefined || typeof details.public === "boolean");
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to save event details" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { eventId?: number; details?: unknown };
  if (!Number.isInteger(body.eventId) || (body.eventId ?? -1) < 0 || !validDetails(body.details)) {
    return Response.json({ error: "Bad event details" }, { status: 400 });
  }
  try {
    const event = await events.get(body.eventId!);
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });
    if (event.host !== accountId) return Response.json({ error: "Only the event host can save details" }, { status: 403 });
    const details = body.details as EventDetails;
    const existing = await getEventDetails(body.eventId!);
    const locationIssue = locationProblem(details.location);
    if (locationIssue && details.location.trim() !== (existing?.location ?? "").trim()) {
      return Response.json({ error: locationIssue }, { status: 400 });
    }
    const cover = details.cover_url?.trim() ?? "";
    await saveEventDetails(body.eventId!, {
      location: details.location.trim(),
      description: details.description.trim(),
      cover_url: cover ? new URL(cover).href : null,
      // The manage page saves without this field; keep what the host chose at creation.
      ...((details.public ?? existing?.public) === false ? { public: false } : {}),
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not save event details" }, { status: 503 });
  }
}
