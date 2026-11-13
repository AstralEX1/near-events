"use client";

// Browser side of NEAR Intents 1Click. Every request goes through our
// /api/oneclick proxy, so the API key stays on the server.
import { USDC_CONTRACT } from "./config.ts";
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
  quoteId?: string;
}

/** USDC on NEAR as 1Click names it. */
export const USDC_ASSET = `nep141:${USDC_CONTRACT}`;

/** USDC storage registration, refunded if the account already has it. */
const STORAGE_DEPOSIT = 1_250_000_000_000_000_000_000n;

let tokenList: Promise<OneClickToken[]> | null = null;

export function oneClickTokens(): Promise<OneClickToken[]> {
  tokenList ??= fetch("/api/oneclick/tokens", { signal: AbortSignal.timeout(12_000) })
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
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ slippageTolerance: 100, referral: "near-events", deadline: new Date(Date.now() + 60 * 60_000).toISOString(), ...body }),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.message ?? json.error ?? `NEAR Intents error ${r.status}`);
  return json.quote;
}

export const INTENTS_SESSION_EXPIRED = "Your NEAR Intents sign-in has expired. Sign in again.";

/** Any other proxied 1Click call; `session` is the guest's own 1Click session (Confidential balance). */
export async function oneClickCall<T>(path: string, body?: unknown, session?: string): Promise<T> {
  const r = await fetch(`/api/oneclick/${path}`, {
    method: body === undefined ? "GET" : "POST",
    signal: AbortSignal.timeout(20_000),
    headers: session ? { Authorization: `Bearer ${session}` } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (r.status === 401 && session) throw new Error(INTENTS_SESSION_EXPIRED);
  if (!r.ok) throw new Error(json.message ?? json.error ?? `NEAR Intents error ${r.status}`);
  return json as T;
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export async function oneClickStatus(depositAddress: string, memo?: string, signal?: AbortSignal): Promise<SwapStatus | null> {
  const query = new URLSearchParams({ depositAddress });
  if (memo) query.set("memo", memo);
  const deadline = AbortSignal.timeout(10_000);
  try {
    const res = await fetch(`/api/oneclick/status?${query}`, {
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    return res.ok ? (await res.json()).status ?? null : null;
  } catch {
    return null;
  }
}

/** Resolves only after delivery. A timeout means the swap may still settle. */
export async function waitForSwap(
  depositAddress: string, onStatus?: (s: SwapStatus) => void,
  options: { memo?: string; signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000), ...(options.signal ? [options.signal] : [])]);
  let delay = 4000;
  while (!signal.aborted) {
    const status = await oneClickStatus(depositAddress, options.memo, signal);
    if (signal.aborted) break;
    if (status) onStatus?.(status);
    if (status === "SUCCESS") return;
    if (status === "REFUNDED") throw new Error("1Click refunded the swap to the refund destination.");
    if (status === "FAILED" || status === "INCOMPLETE_DEPOSIT") {
      throw new Error(`1Click status: ${status.toLowerCase().replaceAll("_", " ")}. Check this payment before sending again.`);
    }
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, delay);
      signal.addEventListener("abort", finish, { once: true });
    });
    delay = Math.min(delay * 2, 20_000);
  }
  throw new Error("The swap may still be processing. Check the existing payment before sending again.");
}

/** Storage deposit so the escrow's `ft_transfer` to a 1Click address can't fail. */
export function registerUsdcFor(account: string): Call {
  return {
    receiverId: USDC_CONTRACT,
    methodName: "storage_deposit",
    args: { account_id: account, registration_only: true },
    deposit: STORAGE_DEPOSIT,
    gas: 30_000_000_000_000n,
  };
}
