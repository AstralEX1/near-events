import { FASTAUTH_CLIENT_ID } from "@/lib/config";
import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { NETWORK } from "@/lib/config";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";
import { FASTAUTH_CONTRACT, relayer } from "@/lib/relayer";
import { decodePayload, relayAllowed, type Payload } from "@/lib/relayPolicy";
import { CONTRACTS, relayRefusal } from "@/lib/relayServer";

// The payload is a transaction (testnet) or a NEP-366 delegate action (mainnet meta-transaction).
function allowedPayload(signPayload: unknown): Payload | null {
  if (!Array.isArray(signPayload) || signPayload.length > 8192 || !signPayload.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  const p = decodePayload(Uint8Array.from(signPayload as number[]));
  return p && relayAllowed(p, CONTRACTS) ? p : null;
}

// Match the pinned FastAuth JavascriptProvider's issuer and signing audience.
const ISSUER = NETWORK === "mainnet" ? "https://login.auth.near.org/" : "https://login.testnet.fast-auth.com/";
const AUDIENCE = `auth0.jwt.${FASTAUTH_CONTRACT}`;
let jwks: { expires: number; keys: Promise<(JsonWebKey & { kid?: string })[]> } | undefined;

async function matchesFastAuthToken(token: string, guard: string, transaction: number[]) {
  if (guard !== `jwt#${ISSUER}`) return false;
  const [header, body, signature, extra] = token.split(".");
  if (extra !== undefined || !header || !body || !signature) return false;
  const { alg, kid } = JSON.parse(Buffer.from(header, "base64url").toString());
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  const now = Date.now() / 1000;
  if (alg !== "RS256" || typeof kid !== "string" || claims.iss !== ISSUER
    || ![claims.aud].flat().includes(AUDIENCE) || typeof claims.exp !== "number" || claims.exp <= now
    || (claims.nbf !== undefined && (typeof claims.nbf !== "number" || claims.nbf > now))
    || !Array.isArray(claims.fatxn) || claims.fatxn.length !== transaction.length
    || !transaction.every((byte, index) => byte === claims.fatxn[index])) return false;
  if (!jwks || jwks.expires <= Date.now()) {
    jwks = { expires: Date.now() + 5 * 60_000, keys: fetch(`${ISSUER}.well-known/jwks.json`, {
      signal: AbortSignal.timeout(4000),
    }).then(async (response) => {
      if (!response.ok) throw new Error("FastAuth public keys unavailable");
      const { keys } = await response.json();
      return keys;
    }).catch(() => {
      if (jwks) jwks.expires = Date.now() + 5000;
      return [];
    }) };
  }
  const key = (await jwks.keys).find((item) => item.kid === kid && item.kty === "RSA");
  return !!key && verify("RSA-SHA256", Buffer.from(`${header}.${body}`),
    createPublicKey({ key, format: "jwk" }), Buffer.from(signature, "base64url"));
}

// Relays a NEAR Auth signature request: the relayer calls `sign` on the
// fast-auth contract, which checks the user's Auth0 JWT and asks the MPC
// network to sign the user's transaction. The relayer only pays gas; it cannot
// change what the user approved, because the JWT commits to the transaction.
export async function POST(req: Request) {
  // Google/email sign-in is off (no NEAR Auth client): nobody may spend the relayer's NEAR here.
  if (!FASTAUTH_CLIENT_ID) return Response.json({ error: "Google and email sign-in are not enabled" }, { status: 503 });
  if (rateLimited(req)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const request = await req.json().catch(() => null);
  if (!request || typeof request.guard_id !== "string" || !request.verify_payload
    || !request.sign_payload || (request.algorithm !== undefined && request.algorithm !== "eddsa")
    || typeof request.verify_payload !== "string" || request.verify_payload.length > 16_384) {
    return Response.json({ error: "Invalid signature request" }, { status: 400 });
  }
  const { guard_id, verify_payload, sign_payload } = request;
  const tx = allowedPayload(sign_payload);
  if (!tx) {
    return Response.json({ error: "Only Nearvent transactions are relayed" }, { status: 400 });
  }
  // The relayer would also pay a delegate action's deposits, so /api/fastauth/relay refuses them; don't sign them either.
  if (tx.delegate && tx.calls.some((call) => call.deposit > 1n)) {
    return Response.json({ error: "Google and email accounts can create free events only: up to 50 seats, 2 in 30 days, ending within 60 days." }, { status: 400 });
  }
  const account = tx.signerId;
  try {
    const refusal = await relayRefusal(tx);
    if (refusal) return Response.json({ error: refusal }, { status: 400 });
  } catch {
    return Response.json({ error: "Could not check the event's storage cost" }, { status: 502 });
  }
  try {
    if (!await matchesFastAuthToken(verify_payload, guard_id, sign_payload)) throw new Error();
  } catch {
    return Response.json({ error: "FastAuth authorization could not be verified" }, { status: 401 });
  }
  const requestId = createHash("sha256").update(verify_payload).digest("hex");
  if (await paidRequestLimited(req, "fastauth", account, requestId)) return Response.json({ error: "Relayer quota unavailable or exceeded" }, { status: 429 });
  try {
    const outcome = await relayer().callFunctionRaw({
      contractId: FASTAUTH_CONTRACT,
      methodName: "sign",
      args: { guard_id, verify_payload, sign_payload, algorithm: "eddsa" },
      gas: 300_000_000_000_000n,
      deposit: 1n,
    });
    const status = outcome.status as { SuccessValue?: string; Failure?: unknown };
    if (!status.SuccessValue) {
      return Response.json({ error: "Signing failed" }, { status: 502 });
    }
    return Response.json({ signature: status.SuccessValue });
  } catch {
    return Response.json({ error: "The signing request could not be completed" }, { status: 502 });
  }
}
