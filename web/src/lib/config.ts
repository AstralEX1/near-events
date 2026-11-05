// Public settings only. Account ids are not secrets; keys never live in the web app.
export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ?? "testnet") as "testnet" | "mainnet";
// Testnet runs on Tidepool, a community 1Click sandbox with the official NEAR
// Intents verifier and its own test USDC (https://www.usetidepool.tech/docs).
export const EVENTS_CONTRACT = process.env.NEXT_PUBLIC_EVENTS_CONTRACT ?? "escrow-tp2.nearevents-11022103.testnet";
export const USDC_CONTRACT = process.env.NEXT_PUBLIC_USDC_CONTRACT ?? "usdc.tidepool-sandbox.testnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ??
  // FastNEAR: the old rpc.*.near.org endpoints are deprecated and rate-limit browsers hard.
  (NETWORK === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com");
export const EXPLORER_URL = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
/** Testnet USDC comes from the Tidepool faucet. */
export const HAS_FAUCET = NETWORK === "testnet";
export const USDC_DECIMALS = 6;
/** NEAR Intents verifier: intents.near on mainnet, Tidepool's copy on testnet. */
export const INTENTS_CONTRACT: string | null =
  process.env.NEXT_PUBLIC_INTENTS_CONTRACT ?? (NETWORK === "mainnet" ? "intents.near" : "verifier.tidepool-sandbox.testnet");
/** Every payment and payout goes through NEAR Intents when a verifier is set. */
export const HAS_INTENTS = !!INTENTS_CONTRACT;
/**
 * 1Click can register a guest in the same swap (customRecipientMsg → the
 * escrow's ft_transfer_call). Mainnet 1Click does this; Tidepool drops the
 * message and sends a plain ft_transfer, which would strand the deposit.
 */
export const ONECLICK_REGISTERS = NETWORK === "mainnet";
