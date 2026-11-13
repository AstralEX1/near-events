import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { linkWallets, unlinkWallet, walletsOf } from "@/lib/profiles";

// Wallets of one person share a profile. Every call needs the sign-in token of a wallet
// in that profile; linking needs the tokens of both wallets, so each one is proven.
// GET                     → { wallets: [profile wallet, ...linked] } of the signed-in wallet
// POST { other: token }   → links the wallet of `other` with the signed-in one
// DELETE { account }      → unlinks `account` from the signed-in wallet's profile
const signedIn = (req: Request) => {
  try {
    return readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {
    return null;
  }
};
const UNAVAILABLE = () => Response.json({ error: "Profiles are temporarily unavailable" }, { status: 503 });

export async function GET(req: Request) {
  if (rateLimited(req, 120)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const account = signedIn(req);
  if (!account) return Response.json({ error: "Sign in again" }, { status: 401 });
  try {
    return Response.json({ wallets: await walletsOf(account) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return UNAVAILABLE();
  }
}

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const account = signedIn(req);
  const body = (await req.json().catch(() => null)) as { other?: unknown } | null;
  const other = typeof body?.other === "string" ? readStaffToken(body.other) : null;
  if (!account || !other) return Response.json({ error: "Sign in with both wallets again" }, { status: 401 });
  if (other === account) return Response.json({ error: "That is the wallet you are signed in with" }, { status: 400 });
  try {
    const problem = await linkWallets(account, other);
    return problem ? Response.json({ error: problem }, { status: 409 }) : Response.json({ wallets: await walletsOf(account) });
  } catch {
    return UNAVAILABLE();
  }
}

export async function DELETE(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const account = signedIn(req);
  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  if (!account) return Response.json({ error: "Sign in again" }, { status: 401 });
  try {
    const wallets = await walletsOf(account);
    if (typeof body?.account !== "string" || !wallets.slice(1).includes(body.account)) {
      return Response.json({ error: "This wallet is not linked to your profile" }, { status: 400 });
    }
    await unlinkWallet(body.account);
    return Response.json({ wallets: await walletsOf(account) });
  } catch {
    return UNAVAILABLE();
  }
}
