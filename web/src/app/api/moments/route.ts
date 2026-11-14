import { dailyLimited, rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { COVERS_FULL, isCoverId, isJpeg, MAX_COVER_BYTES, saveCover } from "@/lib/covers";
import { addMoment, listMoments, parseScope, removeMoment, roles } from "@/lib/moments";
import { momentProblem } from "@/lib/momentsShared";

// Photos from a past event: anyone can look; its guests, host and door team add them.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

function signedIn(req: Request): string | null {
  try {
    return readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (rateLimited(req, 60)) return fail("Too many requests", 429);
  const scope = parseScope(new URL(req.url).searchParams);
  if (!scope) return fail("Bad event id");
  try {
    return Response.json({ moments: await listMoments(scope) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail("Photos are temporarily unavailable", 503);
  }
}

export async function POST(req: Request) {
  if (rateLimited(req, 30)) return fail("Too many uploads", 429);
  const account = signedIn(req);
  if (!account) return fail("Sign in again to add photos", 401);
  const scope = parseScope(new URL(req.url).searchParams);
  if (!scope) return fail("Bad event id");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_COVER_BYTES) return fail("Photo is too large", 413);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) return fail("Photo is too large", 413);
  if (!isJpeg(bytes)) return fail("Upload a JPEG image");
  try {
    const place = await roles(scope, account);
    if (!place) return fail("Event not found", 404);
    const problem = momentProblem(place);
    if (problem) return fail(problem, 403);
    // Sign-in is free (any fresh EVM key), so photos are also capped per IP and account a day.
    if (await dailyLimited(req, "moments", account, 100)) return fail("Too many photos today. Try again tomorrow.", 429);
    const id = await saveCover(bytes);
    const moment = { id, url: `/api/covers/${id}`, by: account, at: Date.now() };
    const full = await addMoment(scope, moment);
    return full ? fail(full, 409) : Response.json({ moment });
  } catch (e) {
    return fail(e instanceof Error && e.message === COVERS_FULL ? "Photo storage is full right now. Try again later." : "Could not save the photo", 503);
  }
}

export async function DELETE(req: Request) {
  if (rateLimited(req)) return fail("Too many requests", 429);
  const account = signedIn(req);
  if (!account) return fail("Sign in again to remove photos", 401);
  const q = new URL(req.url).searchParams;
  const scope = parseScope(q);
  const id = q.get("m") ?? "";
  if (!scope || !isCoverId(id)) return fail("Bad photo id");
  try {
    const place = await roles(scope, account);
    if (!place) return fail("Event not found", 404);
    const problem = await removeMoment(scope, id, account, place.host);
    return problem ? fail(problem, problem === "Photo not found" ? 404 : 403) : Response.json({ ok: true });
  } catch {
    return fail("Could not remove the photo", 503);
  }
}
