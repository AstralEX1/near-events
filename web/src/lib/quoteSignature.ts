// 1Click signs every quote. Before we show a deposit address or send money to it, the browser
// checks the signature, so a tampered proxy or server can't swap in its own address.
// Mirrors verifyQuoteSignature() in @defuse-protocol/one-click-sdk-typescript (src/quote-signature.ts).
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ONE_CLICK_KEY = "reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

type Fields = Record<string, unknown>;
export interface SignedQuoteResponse {
  quoteRequest: Fields;
  quote: Fields;
  signature: string;
  timestamp: string;
}

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b) break; out = "1" + out; }
  return out;
}

function base58Decode(text: string): Uint8Array {
  let n = 0n;
  for (const c of text) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("Bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of text) { if (c !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

/** json-stable-stringify: keys sorted, undefined left out. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stable(v))).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter((k) => (value as Fields)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Fields)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The message 1Click signs: base58(sha256(stable JSON of the request, the quote and the timestamp)). */
export function quoteMessage(r: SignedQuoteResponse): string {
  const q = r.quoteRequest;
  const x = r.quote;
  const or = (v: unknown) => v || undefined;
  const request = {
    dry: q.dry, swapType: q.swapType, slippageTolerance: q.slippageTolerance, originAsset: q.originAsset,
    depositType: q.depositType, destinationAsset: q.destinationAsset, amount: q.amount, refundTo: q.refundTo,
    refundType: q.refundType, recipient: q.recipient, recipientType: q.recipientType, deadline: q.deadline,
    quoteWaitingTimeMs: or(q.quoteWaitingTimeMs), referral: or(q.referral), virtualChainRecipient: or(q.virtualChainRecipient),
    virtualChainRefundRecipient: or(q.virtualChainRefundRecipient), customRecipientMsg: or(q.customRecipientMsg),
  };
  const amounts = {
    amountIn: x.amountIn, amountInFormatted: x.amountInFormatted, amountInUsd: x.amountInUsd, minAmountIn: x.minAmountIn,
    amountOut: x.amountOut, amountOutFormatted: x.amountOutFormatted, amountOutUsd: x.amountOutUsd, minAmountOut: x.minAmountOut,
  };
  // A live quote also signs where to pay; its `deadline` replaces the request's (even when empty).
  const quote = q.dry ? amounts : {
    ...amounts, depositAddress: or(x.depositAddress), depositMemo: or(x.depositMemo), deadline: or(x.deadline),
    timeWhenInactive: or(x.timeWhenInactive), timeEstimate: or(x.timeEstimate), refundFee: or(x.refundFee), withdrawFee: or(x.withdrawFee),
  };
  return base58Encode(sha256(new TextEncoder().encode(stable({ ...request, ...quote, timestamp: r.timestamp }))));
}

/** True when 1Click signed exactly this quote. */
export function quoteSigned(r: SignedQuoteResponse, key = ONE_CLICK_KEY): boolean {
  try {
    const signature = base58Decode(r.signature.replace(/^ed25519:/, ""));
    return ed25519.verify(signature, new TextEncoder().encode(quoteMessage(r)), base58Decode(key));
  } catch {
    return false;
  }
}
