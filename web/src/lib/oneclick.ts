// Server-side 1Click client. The optional API key (a JWT from partners.near-intents.org)
// is read from ONECLICK_API_KEY and never sent to the browser. Without it 1Click adds
// 0.25% to every quote; with it, 0.01% for USDC pairs.
// Testnet uses Tidepool, which speaks the same 1Click API.
export const ONECLICK_URL =
  process.env.ONECLICK_URL ?? ((process.env.NEXT_PUBLIC_NETWORK ?? "testnet") === "mainnet" ? "https://1click.chaindefuser.com" : "https://www.usetidepool.tech");

export async function oneClick(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (process.env.ONECLICK_API_KEY) headers.set("Authorization", `Bearer ${process.env.ONECLICK_API_KEY}`);
  return fetch(`${ONECLICK_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(12_000), cache: "no-store" });
}

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}
