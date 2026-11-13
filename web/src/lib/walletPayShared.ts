// The order and the margins of the wallet-token pick, without network calls (tested).
import type { OneClickToken } from "./oneclick";

export interface Candidate {
  token: OneClickToken;
  /** On the wallet's current network: no network switch. */
  current: boolean;
  balance: () => Promise<bigint>;
}

const STABLES = new Set(["USDC", "USDT"]);

/** Order: USDC on the current network, then USDC/USDT anywhere, then native coins. */
export function rank(c: Pick<Candidate, "token" | "current">): number {
  const stable = STABLES.has(c.token.symbol);
  if (c.token.symbol === "USDC" && c.current) return 0;
  if (stable) return c.current ? 1 : 2;
  return 3;
}

/**
 * Smallest balance (token units) that safely covers `need` NEAR USDC (6 decimals):
 * stablecoins +2% for the swap, native coins +5% and about $1 left for network fees.
 * Null without a price.
 */
export function enough(token: OneClickToken, need: bigint): bigint | null {
  const scale = 10n ** BigInt(token.decimals);
  if (STABLES.has(token.symbol)) return (need * 102n * scale) / (100n * 1_000_000n);
  if (!token.price || token.price <= 0) return null;
  const usdMicros = (need * 105n) / 100n + 1_000_000n;
  // price in USD per whole token, kept to 6 decimals
  const priceMicros = BigInt(Math.round(token.price * 1_000_000));
  return (usdMicros * scale) / priceMicros;
}

/** Checks balances in order of preference and returns the first token that covers the need. */
export async function pickWalletToken(candidates: Candidate[], need: bigint): Promise<OneClickToken | null> {
  const sorted = [...candidates].sort((a, b) => rank(a) - rank(b));
  const results = await Promise.all(sorted.map((c) => c.balance().catch(() => 0n)));
  for (let i = 0; i < sorted.length; i++) {
    const min = enough(sorted[i].token, need);
    if (min !== null && results[i] >= min) return sorted[i].token;
  }
  return null;
}
