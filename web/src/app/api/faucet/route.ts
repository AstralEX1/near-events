import { NETWORK, USDC_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";

// Testnet only: mints test USDC to an account so guests can register without
// signing an extra transaction. The token itself caps each mint at 1000 USDC.
const MAX_UNITS = 100_000_000n; // 100 USDC

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return Response.json({ error: "Testnet only" }, { status: 403 });
  const { accountId, amount } = await req.json();
  let units: bigint;
  try {
    units = BigInt(amount);
  } catch {
    return Response.json({ error: "Bad amount" }, { status: 400 });
  }
  if (typeof accountId !== "string" || units <= 0n || units > MAX_UNITS) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    await relayer().callFunction({
      contractId: USDC_CONTRACT,
      methodName: "mint",
      args: { amount: units.toString(), account_id: accountId },
      gas: 30_000_000_000_000n,
    });
    return Response.json({ minted: units.toString() });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
