"use client";

// Browser side of NEAR Intents 1Click. Every request goes through our
// /api/oneclick proxy, so the API key stays on the server.
import { EVENTS_CONTRACT, USDC_CONTRACT } from "./config";
import type { Call } from "./wallet";
import type { OneClickToken } from "./oneclick";

export interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOut: string;
  amountOutFormatted: string;
  timeEstimate?: number;
  deadline?: string;
}

/** USDC on NEAR as 1Click names it. */
export const USDC_ASSET = `nep141:${USDC_CONTRACT}`;

/** USDC storage registration, refunded if the account already has it. */
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;

let tokenList: Promise<OneClickToken[]> | null = null;

export function oneClickTokens(): Promise<OneClickToken[]> {
  tokenList ??= fetch("/api/oneclick/tokens")
    .then((r) => r.json())
    .then((t: OneClickToken[] | { error: string }) => {
      if (!Array.isArray(t)) throw new Error(t.error);
      return t;
    })
    .catch((e) => {
      tokenList = null;
      throw new Error(`Could not load tokens from NEAR Intents: ${e instanceof Error ? e.message : e}`);
    });
  return tokenList;
}

export async function oneClickQuote(body: Record<string, unknown>): Promise<Quote> {
  const r = await fetch("/api/oneclick/quote", {
    method: "POST",
    body: JSON.stringify({ slippageTolerance: 100, referral: "near-events", deadline: new Date(Date.now() + 60 * 60_000).toISOString(), ...body }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? json.error ?? `NEAR Intents error ${r.status}`);
  return json.quote;
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export async function oneClickStatus(depositAddress: string): Promise<SwapStatus | null> {
  const r = await fetch(`/api/oneclick/status?depositAddress=${encodeURIComponent(depositAddress)}`)
    .then((x) => x.json())
    .catch(() => null);
  return r?.status ?? null;
}

/** Waits until 1Click settles the swap. Resolves on SUCCESS, throws on refund/failure/timeout. */
export async function waitForSwap(depositAddress: string, onStatus?: (s: SwapStatus) => void, timeoutMs = 10 * 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const s = await oneClickStatus(depositAddress);
    if (s) onStatus?.(s);
    if (s === "SUCCESS") return;
    if (s === "REFUNDED") throw new Error("NEAR Intents refunded the payment. Nothing was charged.");
    if (s === "FAILED" || s === "INCOMPLETE_DEPOSIT") throw new Error(`NEAR Intents payment ${s.toLowerCase().replace("_", " ")}.`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("NEAR Intents is still processing. Check back in a few minutes.");
}

/**
 * Quote for an RSVP deposit paid from a NEAR account: 1Click delivers exactly
 * the deposit in USDC to the escrow with a register message naming the guest.
 */
export function registerQuote(opts: { originAsset: string; eventId: number; deposit: string; guest: string; refundTo: string; refundType?: "ORIGIN_CHAIN" | "INTENTS"; dry?: boolean }) {
  return oneClickQuote({
    dry: opts.dry ?? false,
    swapType: "EXACT_OUTPUT",
    // USDC → USDC has no price risk; 1Click pads amountIn by the slippage.
    ...(opts.originAsset === USDC_ASSET ? { slippageTolerance: 10 } : {}),
    originAsset: opts.originAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: USDC_ASSET,
    amount: opts.deposit,
    refundTo: opts.refundTo,
    refundType: opts.refundType ?? "ORIGIN_CHAIN",
    recipient: EVENTS_CONTRACT,
    recipientType: "DESTINATION_CHAIN",
    customRecipientMsg: JSON.stringify({ action: "register", event_id: opts.eventId, guest: opts.guest }),
  });
}

/** The NEAR wallet calls that pay a 1Click deposit address with a NEP-141 token. */
export function payDepositAddress(tokenContract: string, depositAddress: string, amount: string): Call[] {
  return [
    {
      receiverId: tokenContract,
      methodName: "storage_deposit",
      args: { account_id: depositAddress, registration_only: true },
      deposit: STORAGE_DEPOSIT,
      gas: 30_000_000_000_000n,
    },
    { receiverId: tokenContract, methodName: "ft_transfer", args: { receiver_id: depositAddress, amount }, deposit: 1n, gas: 50_000_000_000_000n },
  ];
}

/** NEP-141 contract behind a 1Click asset id ("nep141:usdc.near" → "usdc.near"). */
export function nep141Contract(assetId: string): string | null {
  return assetId.startsWith("nep141:") ? assetId.slice(7) : null;
}

/** Storage deposit so the escrow's `ft_transfer` to a 1Click address can't fail. */
export function registerUsdcFor(account: string): Call {
  return payDepositAddress(USDC_CONTRACT, account, "0")[0];
}
