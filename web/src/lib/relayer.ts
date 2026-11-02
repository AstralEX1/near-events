// Server-only testnet relayer. Its key comes from RELAYER_PRIVATE_KEY (gitignored .env.local).
import "server-only";
import { Account, JsonRpcProvider } from "near-api-js";
import { NETWORK, RPC_URL } from "./config";

export function relayer(): Account {
  const id = process.env.RELAYER_ACCOUNT_ID;
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!id || !key) throw new Error("Relayer is not configured (RELAYER_ACCOUNT_ID / RELAYER_PRIVATE_KEY)");
  return new Account(id, new JsonRpcProvider({ url: RPC_URL }), key as `ed25519:${string}`);
}

export const rpc = () => new JsonRpcProvider({ url: RPC_URL });

export const FASTAUTH_CONTRACT = NETWORK === "mainnet" ? "fast-auth.near" : "fast-auth.testnet";
export const MPC_CONTRACT = NETWORK === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet";

export async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc().viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}
