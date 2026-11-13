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
  // Single call: NEAR's view_account. EVM balances go in batches (evmBalances).
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

/** Balances of `tokens` (all on one EVM network) held by `address`, in one batched RPC request. */
async function evmBalances(address: string, chain: string, tokens: OneClickToken[]): Promise<Map<string, bigint>> {
  const calls = tokens.map((t, id) => ({
    jsonrpc: "2.0", id,
    ...(t.contractAddress
      ? { method: "eth_call", params: [{ to: t.contractAddress, data: `0x70a08231${address.slice(2).padStart(64, "0")}` }, "latest"] }
      : { method: "eth_getBalance", params: [address, "latest"] }),
  }));
  const res = await fetch(EVM_RPC[chain], {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls), signal: AbortSignal.timeout(8000),
  });
  const out = new Map<string, bigint>();
  for (const r of (await res.json()) as { id: number; result?: string }[]) {
    const hex = r.result && r.result !== "0x" ? r.result : "0x0";
    try { out.set(tokens[r.id].assetId, BigInt(hex.slice(0, 66))); } catch { /* not a number: no balance */ }
  }
  return out;
}

/** The wallet's balance of every token it can send itself (EVM: our 8 networks; NEAR: native NEAR as wNEAR). */
export async function walletBalances(kind: string | null, account: string, tokens: OneClickToken[]): Promise<Map<string, bigint>> {
  if (kind === "wallet") {
    const wnear = tokens.find((t) => t.assetId === "nep141:wrap.near");
    return new Map(wnear ? [[wnear.assetId, await nearBalance(account).catch(() => 0n)]] : []);
  }
  if (kind !== "evm") return new Map();
  const byChain = new Map<string, OneClickToken[]>();
  for (const t of tokens) if (EVM_RPC[t.blockchain]) byChain.set(t.blockchain, [...(byChain.get(t.blockchain) ?? []), t]);
  // A slow or failing network just shows no balances.
  const parts = await Promise.all([...byChain].map(([chain, list]) => evmBalances(account, chain, list).catch(() => new Map<string, bigint>())));
  return new Map(parts.flatMap((m) => [...m]));
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
export async function walletToken(kind: string | null, account: string, need: bigint, tokens: OneClickToken[], chainId: number | null, held?: Map<string, bigint>): Promise<OneClickToken | null> {
  const balances = held ?? (await walletBalances(kind, account, tokens));
  const current = kind === "evm" ? Object.entries(EVM_CHAIN_IDS).find(([, id]) => id === chainId)?.[0] ?? "base" : "near";
  const candidates: Candidate[] = [];
  for (const t of tokens) {
    if (!balances.has(t.assetId)) continue;
    const stable = t.symbol === "USDC" || t.symbol === "USDT";
    const native = !t.contractAddress && t.blockchain === current;
    if (stable || native || t.assetId === "nep141:wrap.near") {
      candidates.push({ token: t, current: t.blockchain === current, balance: async () => balances.get(t.assetId) ?? 0n });
    }
  }
  return pickWalletToken(candidates, need);
}
