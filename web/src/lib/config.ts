// Public settings only. Account ids are not secrets; keys never live in the web app.
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const EVENTS_CONTRACT = process.env.NEXT_PUBLIC_EVENTS_CONTRACT ?? "escrow-v3.nearevents-11022103.testnet";
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT ?? "usdc-nearevents-11022103.testnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  // FastNEAR: the old rpc.*.near.org endpoints are deprecated and rate-limit browsers hard.
  (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com");
export const EXPLORER_URL = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** The testnet token has an open faucet (`mint`). */
export const HAS_FAUCET = NETWORK === "testnet";
export const USDC_DECIMALS = 6;
/** NEAR Intents verifier. It exists on mainnet only. */
export const INTENTS_CONTRACT = NETWORK === "mainnet" ? "intents.near" : null;
/** Intents-native features (EVM wallet sign-in, Intents payouts) need mainnet. */
export const HAS_INTENTS = INTENTS_CONTRACT !== null;
