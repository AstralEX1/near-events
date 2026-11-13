import { rateLimited } from "@/lib/ratelimit";
import { issueStaffToken, verifyEvmProof, verifyMpcProof, verifyWalletProof, type EvmProof, type MpcProof, type WalletProof } from "@/lib/staff";

// Sign-in: a wallet proves its account (NEAR, EVM or Google/email) with one signed message and
// gets a 1-day session token (see lib/staff.ts). The token only says who you are: every save and
// check-in still checks what that account may do.
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { wallet?: WalletProof; mpc?: MpcProof; evm?: EvmProof };
  try {
    const accountId = body.wallet ? await verifyWalletProof(body.wallet) : body.mpc ? await verifyMpcProof(body.mpc)
      : body.evm ? verifyEvmProof(body.evm) : null;
    if (!accountId) return Response.json({ error: "Missing proof" }, { status: 400 });
    return Response.json({ accountId, token: issueStaffToken(accountId) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 401 });
  }
}
