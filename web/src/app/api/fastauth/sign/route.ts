import { decodeTransaction } from "near-api-js";
import { EVENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { rateLimited } from "@/lib/ratelimit";
import { FASTAUTH_CONTRACT, relayer } from "@/lib/relayer";

// The relayer only pays for transactions that call our own contracts.
const ALLOWED_RECEIVERS = new Set([EVENTS_CONTRACT, USDC_CONTRACT]);

function isOurTransaction(signPayload: unknown): boolean {
  try {
    const tx = decodeTransaction(Uint8Array.from(signPayload as number[]));
    return ALLOWED_RECEIVERS.has(tx.receiverId) && tx.actions.every((a) => "functionCall" in a);
  } catch {
    return false;
  }
}

// Relays a NEAR Auth signature request: the relayer calls `sign` on the
// fast-auth contract, which checks the user's Auth0 JWT and asks the MPC
// network to sign the user's transaction. The relayer only pays gas; it cannot
// change what the user approved, because the JWT commits to the transaction.
export async function POST(req: Request) {
  const { guard_id, verify_payload, sign_payload, algorithm = "eddsa" } = await req.json();
  if (!guard_id || !verify_payload || !sign_payload) {
    return Response.json({ error: "Missing signature request" }, { status: 400 });
  }
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!isOurTransaction(sign_payload)) {
    return Response.json({ error: "Only Near Events transactions are relayed" }, { status: 400 });
  }
  try {
    const outcome = await relayer().callFunctionRaw({
      contractId: FASTAUTH_CONTRACT,
      methodName: "sign",
      args: { guard_id, verify_payload, sign_payload, algorithm },
      gas: 300_000_000_000_000n,
      deposit: 1n,
    });
    const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
    if (!status.SuccessValue) {
      return Response.json({ error: "Signing failed", detail: status.Failure ?? null }, { status: 502 });
    }
    return Response.json({ signature: status.SuccessValue });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
