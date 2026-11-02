// Public settings only. Account ids are not secrets; keys never live in the web app.
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const EVENTS_CONTRACT = process.env.NEXT_PUBLIC_EVENTS_CONTRACT ?? "nearevents-11022103.testnet";
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT ?? "usdc-nearevents-11022103.testnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  (NETWORK === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
export const EXPLORER_URL = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** The testnet token has an open faucet (`mint`). */
export const HAS_FAUCET = NETWORK === "testnet";
export const USDC_DECIMALS = 6;
