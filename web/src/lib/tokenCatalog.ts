// Names and icons for 1Click tokens and networks, for the token picker.
// Token icons: data taken from @anywalletkit/swap2-assets 0.2.2 (Apache-2.0, the catalog
// NearJar uses), stored as plain JSON in tokenIcons.json; the URLs point at CoinMarketCap
// images. Network logos come from Trust Wallet's open assets repository.
import type { OneClickToken } from "./oneclick";
import data from "./tokenIcons.json";

const TW = (folder: string) => `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/info/logo.png`;

/** 1Click `blockchain` → network name and Trust Wallet folder (none: no logo). */
const CHAINS: Record<string, [string, string?]> = {
  eth: ["Ethereum", "ethereum"], base: ["Base", "base"], arb: ["Arbitrum", "arbitrum"], op: ["Optimism", "optimism"],
  pol: ["Polygon", "polygon"], bsc: ["BNB Chain", "smartchain"], avax: ["Avalanche", "avalanchec"], gnosis: ["Gnosis", "xdai"],
  near: ["NEAR", "near"], sol: ["Solana", "solana"], btc: ["Bitcoin", "bitcoin"], sui: ["Sui", "sui"], ton: ["TON", "ton"],
  tron: ["Tron", "tron"], doge: ["Dogecoin", "doge"], ltc: ["Litecoin", "litecoin"], bch: ["Bitcoin Cash", "bitcoincash"],
  aptos: ["Aptos", "aptos"], xrp: ["XRP Ledger", "xrp"], cardano: ["Cardano", "cardano"], stellar: ["Stellar", "stellar"],
  zec: ["Zcash", "zcash"], dash: ["Dash", "dash"], scroll: ["Scroll", "scroll"], starknet: ["Starknet", "starknet"],
  monad: ["Monad"], bera: ["Berachain"], xlayer: ["X Layer"], hypercore: ["Hyperliquid"], plasma: ["Plasma"],
  hood: ["Robinhood Chain"], abs: ["Abstract"], adi: ["ADI"], aleo: ["Aleo"], fogo: ["Fogo"], miden: ["Miden"],
  movement: ["Movement"], prl: ["PRL"], qtc: ["Quantus"],
};

type Catalog = { chains: Record<string, { label: string; icon: string | null }>; assets: Record<string, { symbol: string; chain: string; icon: string | null }> };
const catalog = data as Catalog;

// The same coin looks the same on every network: one icon per symbol as a fallback.
const bySymbol = new Map<string, string>();
for (const a of Object.values(catalog.assets)) if (a.icon && !bySymbol.has(a.symbol.toUpperCase())) bySymbol.set(a.symbol.toUpperCase(), a.icon);

export const chainName = (chain: string): string => CHAINS[chain]?.[0] ?? chain.charAt(0).toUpperCase() + chain.slice(1);

export function chainIcon(chain: string): string | undefined {
  const folder = CHAINS[chain]?.[1];
  return folder ? TW(folder) : catalog.chains[chain]?.icon ?? undefined;
}

export function tokenIcon(t: Pick<OneClickToken, "assetId" | "symbol">): string | undefined {
  return catalog.assets[t.assetId]?.icon ?? bySymbol.get(t.symbol.toUpperCase().replace(/^W(?=NEAR$|ETH$|BTC$)/, ""));
}
