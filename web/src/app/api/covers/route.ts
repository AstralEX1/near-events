import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { isJpeg, MAX_COVER_BYTES, saveCover } from "@/lib/covers";

// Signed-in hosts upload a cover photo; the response is its public URL.
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return Response.json({ error: "Too many uploads" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to upload a cover" }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_COVER_BYTES) return Response.json({ error: "Cover photo is too large" }, { status: 413 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_COVER_BYTES) return Response.json({ error: "Cover photo is too large" }, { status: 413 });
  if (!isJpeg(bytes)) return Response.json({ error: "Upload a JPEG image" }, { status: 400 });
  try {
    const id = await saveCover(bytes);
    return Response.json({ url: new URL(`/api/covers/${id}`, req.url).href });
  } catch {
    return Response.json({ error: "Could not save the cover photo" }, { status: 503 });
  }
}
