// Public settings only. Account ids are not secrets; keys never live in the web app.
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
const MAINNET = NETWORK === "mainnet";
// Mainnet has no safe default escrow: a missing setting must stop the build, not fall back to testnet.
const mainnetSetting = (name: string, value: string | undefined) => {
  if (!value) throw new Error(`Set ${name} for mainnet (see docs/DEPLOY.md)`);
  return value;
};
// Testnet runs on Tidepool, a community 1Click sandbox with the official NEAR
// Intents verifier and its own test USDC (https://www.usetidepool.tech/docs).
export const EVENTS_CONTRACT = MAINNET
  ? mainnetSetting("NEXT_PUBLIC_EVENTS_CONTRACT", process.env.NEXT_PUBLIC_EVENTS_CONTRACT)
  : process.env.NEXT_PUBLIC_EVENTS_CONTRACT ?? "escrow-tp7.tp7-nv1110.testnet";
/** Native Circle USDC on NEAR mainnet; Tidepool's test USDC on testnet. */
export const USDC_CONTRACT =
  process.env.NEXT_PUBLIC_USDC_CONTRACT ??
  (MAINNET ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : "usdc.tidepool-sandbox.testnet");
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  // FastNEAR: the old rpc.*.near.org endpoints are deprecated and rate-limit browsers hard.
  (MAINNET ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com");
export const EXPLORER_URL = MAINNET ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** Testnet USDC comes from the Tidepool faucet. */
export const HAS_FAUCET = NETWORK === "testnet";
export const TEST_EVM_FAUCET_LIMIT = 20_000_000n;
export const USDC_DECIMALS = 6;
/** NEAR Intents verifier: intents.near on mainnet, Tidepool's copy on testnet. */
export const INTENTS_CONTRACT: string | null =
  process.env.NEXT_PUBLIC_INTENTS_CONTRACT ?? (MAINNET ? "intents.near" : "verifier.tidepool-sandbox.testnet");
/** Every payment and payout goes through NEAR Intents when a verifier is set. */
export const HAS_INTENTS = !!INTENTS_CONTRACT;
/** Live swaps fund the signed-in guest's Intents balance before registration. */
export const LIVE_EVENT_SWAPS = MAINNET;
/**
 * NEAR Auth (Google/email) Auth0 client. Testnet can use the shared client from
 * docs.auth.near.org (it only allows http://localhost:3000); mainnet needs our own.
 */
export const FASTAUTH_CLIENT_ID: string | null =
  process.env.NEXT_PUBLIC_FASTAUTH_CLIENT_ID ?? (MAINNET ? null : "np8paqIpMWmNbzT4xAvOOapZBjsOpptl");
/**
 * Mainnet Google/email accounts hold no NEAR: they sign NEP-366 meta-transactions
 * and our relayer pays the gas. Testnet accounts get 0.5 NEAR and pay their own.
 */
export const FASTAUTH_META_TX = MAINNET;
/** WalletConnect (Reown) project id: EVM wallet apps on phones. Without it only browser-extension wallets work. */
export const WALLETCONNECT_PROJECT_ID: string | null = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || null;
