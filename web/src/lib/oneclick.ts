// Server-side 1Click client. The optional API key is read from ONECLICK_API_KEY
// (gitignored .env.local) and never sent to the browser.
export const ONECLICK_URL = "https://1click.chaindefuser.com";

export async function oneClick(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (process.env.ONECLICK_API_KEY) headers.set("X-API-Key", process.env.ONECLICK_API_KEY);
  return fetch(`${ONECLICK_URL}${path}`, { ...init, headers, cache: "no-store" });
}

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price?: number;
  contractAddress?: string;
}
