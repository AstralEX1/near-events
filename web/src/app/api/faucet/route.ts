import { rateLimited } from "@/lib/ratelimit";
import { NETWORK } from "@/lib/config";
import { ONECLICK_URL } from "@/lib/oneclick";

// Testnet only: asks the Tidepool faucet for test USDC on the guest's NEAR
// account (100 USDC, once an hour per account).
export async function POST(req: Request) {
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (NETWORK !== "testnet") return Response.json({ error: "Testnet only" }, { status: 403 });
  const { accountId } = await req.json();
  if (typeof accountId !== "string" || !/^[a-z0-9._-]{2,64}$/.test(accountId)) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const res = await fetch(`${ONECLICK_URL}/v0/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, mode: "wallet" }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: json.message ?? json.error ?? `Faucet error ${res.status}` }, { status: 502 });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
