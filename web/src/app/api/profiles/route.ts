import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { getProfiles, saveProfile } from "@/lib/profiles";
import { cleanProfile } from "@/lib/profilesShared";

const MAX_BATCH = 100;

// GET ?a=acc1,acc2,…  → { profiles: { [account]: Profile } } for the ones that have a profile
// POST Profile        → saves the signed-in account's profile
export async function GET(req: Request) {
  if (rateLimited(req, 120)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const accounts = [...new Set((new URL(req.url).searchParams.get("a") ?? "").split(",").filter(Boolean))];
  if (accounts.length > MAX_BATCH || accounts.some((a) => a.length > 64)) return Response.json({ error: "Bad accounts" }, { status: 400 });
  try {
    return Response.json({ profiles: await getProfiles(accounts) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Profiles are temporarily unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let accountId: string | null = null;
  try {
    accountId = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!accountId) return Response.json({ error: "Sign in again to save your profile" }, { status: 401 });
  const result = cleanProfile(await req.json().catch(() => null));
  if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
  try {
    const problem = await saveProfile(accountId, result.profile);
    return problem ? Response.json({ error: problem }, { status: 409 }) : Response.json({ profile: result.profile });
  } catch {
    return Response.json({ error: "Could not save. Try again." }, { status: 503 });
  }
}
