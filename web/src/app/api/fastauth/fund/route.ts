import { rateLimited } from "@/lib/ratelimit";
import { NETWORK } from "@/lib/config";
import { accountExists, relayer } from "@/lib/relayer";

// Testnet only: gives a new Google/email user's implicit account a little NEAR
// for gas, so they never have to buy NEAR. Mainnet would use meta-transactions.
const STARTER_NEAR = 50_000_000_000_000_000_000_000n; // 0.05 NEAR

export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (NETWORK !== "testnet") return Response.json({ error: "Testnet only" }, { status: 403 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string" || !/^[0-9a-f]{64}$/.test(accountId)) {
    return Response.json({ error: "Expected an implicit account id" }, { status: 400 });
  }
  if (await accountExists(accountId)) return Response.json({ funded: false, exists: true });
  try {
    await relayer().transfer({ receiverId: accountId, amount: STARTER_NEAR });
    return Response.json({ funded: true, exists: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
