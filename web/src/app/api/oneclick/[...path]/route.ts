import { oneClick } from "@/lib/oneclick";
import { USDC_CONTRACT } from "@/lib/config";
import { paidRequestLimited, rateLimited } from "@/lib/ratelimit";

const USDC_ASSET = `nep141:${USDC_CONTRACT}`;
const QUOTE_KEYS = new Set([
  "dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset",
  "amount", "refundTo", "refundType", "recipient", "recipientType", "deadline", "referral",
]);

function quoteAllowed(body: Record<string, unknown>) {
  if (!body || typeof body !== "object" || Object.keys(body).some((key) => !QUOTE_KEYS.has(key))) return false;
  if (typeof body.dry !== "boolean" || typeof body.amount !== "string" || !/^[1-9]\d{0,38}$/.test(body.amount)
    || ![body.originAsset, body.destinationAsset, body.refundTo, body.recipient].every(
      (value) => typeof value === "string" && value.length <= 200 && /^\S+$/.test(value)
    )) return false;
  return (body.swapType === "EXACT_OUTPUT" && body.destinationAsset === USDC_ASSET
    && body.depositType === "ORIGIN_CHAIN" && body.recipientType === "INTENTS" && body.refundType === "ORIGIN_CHAIN")
    || (body.swapType === "EXACT_INPUT" && body.originAsset === USDC_ASSET
      && ["ORIGIN_CHAIN", "INTENTS"].includes(String(body.depositType))
      && body.recipientType === "DESTINATION_CHAIN" && body.refundType === "INTENTS");
}

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!(path === "quote" ? req.method === "POST" : req.method === "GET" && ["tokens", "status"].includes(path))) {
    return Response.json({ error: "Not allowed" }, { status: 404 });
  }
  if (rateLimited(req, 30)) return Response.json({ error: "Too many requests" }, { status: 429 });
  let body: string | undefined;
  const query = new URL(req.url).searchParams;
  if (path === "quote") {
    try {
      body = await req.text();
      if (body.length > 2048 || !quoteAllowed(JSON.parse(body))) throw new Error();
    } catch {
      return Response.json({ error: "Invalid Nearvent quote" }, { status: 400 });
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
  } else if (query.size > 0) {
    return Response.json({ error: "Unexpected query parameters" }, { status: 400 });
  }
  if (await paidRequestLimited(req, `oneclick:${path}`)) {
    return Response.json({ error: "1Click quota unavailable or exceeded" }, { status: 429 });
  }
  try {
    const res = await oneClick(`/v0/${path}${query.size ? `?${query}` : ""}`, { method: req.method, body });
    if (!res.headers.get("content-type")?.includes("json")) {
      return Response.json({ error: `1Click is unavailable right now (HTTP ${res.status})` }, { status: 502 });
    }
    return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return Response.json({ error: "1Click could not respond. Check the status of any existing payment before retrying." }, { status: 502 });
  }
}

export { handle as GET, handle as POST };
