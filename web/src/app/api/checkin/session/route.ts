import { rateLimited } from "@/lib/ratelimit";
import { issueStaffToken, verifyMpcProof, verifyWalletProof, type MpcProof, type WalletProof } from "@/lib/staff";

// A host or co-host proves their NEAR account once and gets a token for the
// door (see lib/staff.ts). The token alone grants nothing: every check-in
// still checks that the account is staff of that event.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { wallet?: WalletProof; mpc?: MpcProof };
  try {
    const accountId = body.wallet ? await verifyWalletProof(body.wallet) : body.mpc ? await verifyMpcProof(body.mpc) : null;
    if (!accountId) return Response.json({ error: "Missing proof" }, { status: 400 });
    return Response.json({ accountId, token: issueStaffToken(accountId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
