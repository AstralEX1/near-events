import { oneClick } from "@/lib/oneclick";
import { USDC_CONTRACT } from "@/lib/config";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";

const USDC_ASSET = `nep141:${USDC_CONTRACT}`;
const QUOTE_KEYS = new Set([
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset",
  "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline", "referral",
]);
const GET_PATHS = ["tokens", "status", "account/balances"];
// auth/authenticate, generate-intent and submit-intent read and move a guest's Confidential USDC.
const POST_PATHS = ["quote", "auth/authenticate", "generate-intent", "submit-intent", "deposit/submit"];

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => key in value);

const NEAR_ACCOUNT = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const base58 = (value: unknown, prefix: string, min: number, max: number) =>
  typeof value === "string" && new RegExp(`^${prefix}:[1-9A-HJ-NP-Za-km-z]{${min},${max}}$`).test(value);

/** A wallet-signed payload: ERC-191 (EVM wallets) or NEP-413 (NEAR wallets). */
function signedData(value: unknown) {
  if (!isObject(value)) return false;
  if (value.standard === "erc191") {
    return keysAre(value, ["standard", "payload", "signature"]) && typeof value.payload === "string"
      && value.payload.length <= 4096 && base58(value.signature, "secp256k1", 60, 100);
  }
  const p = value.payload;
  return value.standard === "nep413" && keysAre(value, ["standard", "payload", "public_key", "signature"])
    && isObject(p) && keysAre(p, ["recipient", "nonce", "message"])
    && typeof p.recipient === "string" && NEAR_ACCOUNT.test(p.recipient)
    && typeof p.nonce === "string" && /^[A-Za-z0-9+/]{43}=$/.test(p.nonce)
    && typeof p.message === "string" && p.message.length <= 4096
    && base58(value.public_key, "ed25519", 40, 50) && base58(value.signature, "ed25519", 80, 100);
}

function quoteAllowed(body: Record<string, unknown>, session: string | undefined) {
  if (!isObject(body) || Object.keys(body).some((key) => !QUOTE_KEYS.has(key))) return false;
  if (typeof body.dry !== "boolean" || typeof body.amount !== "string" || !/^[1-9]\d{0,38}$/.test(body.amount)
    || ![body.originAsset, body.destinationAsset, body.refundTo, body.recipient].every(
      (value) => typeof value === "string" && value.length <= 200 && /^\S+$/.test(value)
    )) return false;
  return (body.swapType === "EXACT_OUTPUT" && body.destinationAsset === USDC_ASSET
    && body.depositType === "ORIGIN_CHAIN" && body.recipientType === "INTENTS"
    // A failed swap goes back to the sending wallet, or (sent by hand) to the guest's own Intents account.
    && (body.refundType === "ORIGIN_CHAIN" || (body.refundType === "INTENTS" && body.refundTo === body.recipient)))
    || (body.swapType === "EXACT_INPUT" && body.originAsset === USDC_ASSET
      && ["ORIGIN_CHAIN", "INTENTS"].includes(String(body.depositType))
      && body.recipientType === "DESTINATION_CHAIN" && body.refundType === "INTENTS")
    // Confidential USDC of any kind into NEAR USDC on the guest's own public Intents balance.
    || (!!session && body.swapType === "EXACT_OUTPUT" && body.destinationAsset === USDC_ASSET
      && body.depositType === "CONFIDENTIAL_INTENTS" && body.recipientType === "INTENTS"
      && body.refundType === "CONFIDENTIAL_INTENTS" && body.recipient === body.refundTo);
}

function postAllowed(path: string, body: unknown, session: string | undefined) {
  if (!isObject(body)) return false;
  if (path === "quote") return quoteAllowed(body, session);
  if (path === "auth/authenticate") return keysAre(body, ["signedData"]) && signedData(body.signedData);
  // A guest's own deposit transaction, so 1Click notices it sooner.
  if (path === "deposit/submit") {
    return keysAre(body, ["depositAddress", "txHash"]) && [body.depositAddress, body.txHash].every((v) => typeof v === "string" && /^\S{1,160}$/.test(v));
  }
  if (!session || body.type !== "swap_transfer") return false;
  if (path === "generate-intent") {
    return keysAre(body, ["type", "standard", "signerId", "depositAddress"]) && typeof body.signerId === "string"
      && (body.standard === "erc191" ? /^0x[0-9a-f]{40}$/.test(body.signerId) : body.standard === "nep413" && NEAR_ACCOUNT.test(body.signerId))
      && typeof body.depositAddress === "string" && /^\S{1,160}$/.test(body.depositAddress);
  }
  return keysAre(body, ["type", "signedData"]) && signedData(body.signedData);
}

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!(req.method === "POST" ? POST_PATHS : req.method === "GET" ? GET_PATHS : []).includes(path)) {
    return Response.json({ error: "Not allowed" }, { status: 404 });
  }
  if (rateLimited(req, 30)) return Response.json({ error: "Too many requests" }, { status: 429 });
  // A guest's own 1Click session (a JWT from auth/authenticate), only for their near.com balance.
  const authorization = req.headers.get("authorization");
  const session = authorization?.match(/^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/)?.[1];
  if (authorization && (!session || session.length > 4096)) return Response.json({ error: "Invalid session" }, { status: 400 });
  if (path === "account/balances" && !session) return Response.json({ error: "Sign in to read this balance" }, { status: 401 });
  let body: string | undefined;
  const query = new URL(req.url).searchParams;
  if (req.method === "POST") {
    try {
      body = await req.text();
      if (body.length > (path === "quote" ? 2048 : 8192) || !postAllowed(path, JSON.parse(body), session)) throw new Error();
    } catch {
      return Response.json({ error: "Invalid Nearvent request" }, { status: 400 });
    }
  }
  if (path === "status") {
    const depositAddress = query.get("depositAddress");
    const memo = query.get("memo");
    if (!depositAddress || depositAddress.length > 160 || !/^\S+$/.test(depositAddress)
      || (memo !== null && (memo.length > 128 || !/^\S+$/.test(memo)))
      || [...query.keys()].some((key) => key !== "depositAddress" && key !== "memo")) {
      return Response.json({ error: "Invalid deposit address or memo" }, { status: 400 });
    }
  } else if (path === "account/balances") {
    if ([...query.keys()].some((key) => key !== "tokenIds") || (query.get("tokenIds") ?? "").length > 400) {
      return Response.json({ error: "Unexpected query parameters" }, { status: 400 });
    }
  } else if (query.size > 0) {
    return Response.json({ error: "Unexpected query parameters" }, { status: 400 });
  }
  if (await paidRequestLimited(req, `oneclick:${path}`)) {
    return Response.json({ error: "1Click quota unavailable or exceeded" }, { status: 429 });
  }
  try {
    const res = await oneClick(`/v0/${path}${query.size ? `?${query}` : ""}`, { method: req.method, body }, session,
      // Signing in and reading a guest's balance are the guest's own calls: no partner key, as 1Click's docs show.
      path !== "auth/authenticate" && path !== "account/balances");
    if (!res.headers.get("content-type")?.includes("json")) {
      return Response.json({ error: `1Click is unavailable right now (HTTP ${res.status})` }, { status: 502 });
    }
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "1Click could not respond. Check the status of any existing payment before retrying." }, { status: 502 });
  }
}

export { handle as GET, handle as POST };
