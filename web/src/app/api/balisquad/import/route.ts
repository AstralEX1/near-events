import { fetchBaliSquadEvent, baliSquadSlug } from "@/lib/balisquadImport";
import { rateLimited } from "@/lib/ratelimit";

export async function GET(req: Request) {
  if (rateLimited(req, 20)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const input = new URL(req.url).searchParams.get("url") ?? "";
  if (!baliSquadSlug(input)) {
    return Response.json({ error: "Paste one BaliSquad event link like https://balisquad.com/event/example-event" }, { status: 400 });
  }
  try {
    return Response.json(await fetchBaliSquadEvent(input));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Couldn’t read that BaliSquad event" }, { status: 404 });
  }
}
