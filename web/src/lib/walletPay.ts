"use client";

// Which token the guest's own wallet can pay the missing USDC with, picked for them so
// "Deposit with NEAR Intents" is one tap. Balances come from public RPCs (read-only).
// EVM: USDC on the wallet's current network, then USDC/USDT on the other networks we send
// on, then the current network's native coin. NEAR wallets: native NEAR (wrapped on send).
import { RPC_URL } from "./config";
import type { OneClickToken } from "./oneclick";
import { EVM_CHAIN_IDS } from "./oneclickClient";
import { pickWalletToken, type Candidate } from "./walletPayShared";

const EVM_RPC: Record<string, string> = {
  eth: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  arb: "https://arb1.arbitrum.io/rpc",
  op: "https://mainnet.optimism.io",
  pol: "https://polygon-bor-rpc.publicnode.com",
  bsc: "https://bsc-dataseed.binance.org",
  avax: "https://api.avax.network/ext/bc/C/rpc",
  gnosis: "https://rpc.gnosischain.com",
};

async function rpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

/** The token's balance held by `address` on its EVM network, in its smallest unit. */
async function evmBalance(address: string, token: OneClickToken): Promise<bigint> {
  const url = EVM_RPC[token.blockchain];
  if (!url) return 0n;
  const hex = token.contractAddress
    ? await rpc<string>(url, "eth_call", [{ to: token.contractAddress, data: `0x70a08231${address.slice(2).padStart(64, "0")}` }, "latest"])
    : await rpc<string>(url, "eth_getBalance", [address, "latest"]);
  return BigInt(hex && hex !== "0x" ? hex : "0x0");
}

/** Native NEAR the account can spend, in yocto. */
async function nearBalance(account: string): Promise<bigint> {
  const r = await rpc<{ amount: string; locked: string; storage_usage: number }>(RPC_URL, "query", { request_type: "view_account", finality: "final", account_id: account });
  // Storage staking: 1e19 yocto per byte stays locked.
  return BigInt(r.amount) - BigInt(r.storage_usage) * 10n ** 19n;
}

/**
 * The first wallet token that covers `need` NEAR USDC (6 decimals), or null.
 * `chainId`: the EVM wallet's current network, tried first.
 */
export async function walletToken(kind: string | null, account: string, need: bigint, tokens: OneClickToken[], chainId: number | null): Promise<OneClickToken | null> {
  const candidates: Candidate[] = [];
  if (kind === "evm") {
    const current = Object.entries(EVM_CHAIN_IDS).find(([, id]) => id === chainId)?.[0] ?? "base";
    for (const t of tokens) {
      if (!EVM_RPC[t.blockchain]) continue;
      const stable = t.symbol === "USDC" || t.symbol === "USDT";
      const native = !t.contractAddress && t.blockchain === current;
      if (stable || native) candidates.push({ token: t, current: t.blockchain === current, balance: () => evmBalance(account, t) });
    }
  } else if (kind === "wallet") {
    const wnear = tokens.find((t) => t.assetId === "nep141:wrap.near");
    if (wnear) candidates.push({ token: wnear, current: true, balance: () => nearBalance(account) });
  }
  return pickWalletToken(candidates, need);
}
