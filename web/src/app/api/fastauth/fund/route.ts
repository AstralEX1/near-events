import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { NETWORK } from "@/lib/config";
import { accountExists, relayer } from "@/lib/relayer";

// Creates a new Google/email or demo implicit account by sending it NEAR.
// Testnet: enough for gas on the biggest call (closing an event: 300 Tgas ≈ 0.3 NEAR,
// mostly refunded; 0.05 NEAR could not even send a 100 Tgas call).
// Mainnet: only the account's own storage (182 bytes); the relayer pays every
// transaction's gas and 1 yoctoNEAR deposit (meta-transactions, /api/fastauth/relay).
const STARTER_NEAR = NETWORK === "mainnet"
  ? 3_000_000_000_000_000_000_000n // 0.003 NEAR
  : 500_000_000_000_000_000_000_000n; // 0.5 NEAR

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string" || !/^[0-9a-f]{64}$/.test(accountId)) {
    return Response.json({ error: "Expected an implicit account id" }, { status: 400 });
  }
  if (await accountExists(accountId)) return Response.json({ funded: false, exists: true });
  try {
    if (await paidRequestLimited(req, "fund", accountId)) return Response.json({ error: "Funding quota unavailable or exceeded" }, { status: 429 });
    await relayer().transfer({ receiverId: accountId, amount: STARTER_NEAR });
    return Response.json({ funded: true, exists: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
