"use client";

// Guests who sign in with an EVM wallet (MetaMask, Rabby, Coinbase…). Their
// NEAR Events account is their NEAR Intents account: the lowercase 0x address.
// They never hold NEAR: they sign intents with their wallet (ERC-191) and our
// relayer submits them to intents.near, paying the gas.
import { baseEncode } from "near-api-js";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "./config";
import { view } from "./near";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function ethereum(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask or another browser wallet.");
  return eth;
}

export async function connectEvm(): Promise<string> {
  const [address] = (await ethereum().request({ method: "eth_requestAccounts" })) as string[];
  if (!address) throw new Error("Wallet returned no address");
  return address.toLowerCase();
}

export async function evmAccount(): Promise<string | null> {
  try {
    const [address] = (await ethereum().request({ method: "eth_accounts" })) as string[];
    return address?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** USDC this account holds inside NEAR Intents. */
export async function intentsUsdcBalance(accountId: string): Promise<bigint> {
  if (!INTENTS_CONTRACT) return 0n;
  const b = await view<string>("mt_balance_of", { account_id: accountId, token_id: `nep141:${USDC_CONTRACT}` }, INTENTS_CONTRACT);
  return BigInt(b);
}

/** Nonce: the verifier's 4-byte salt followed by 28 random bytes, base64. */
async function nonce(): Promise<string> {
  const salt = await view<string>("current_salt", {}, INTENTS_CONTRACT!);
  const bytes = new Uint8Array(32);
  bytes.set(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  crypto.getRandomValues(bytes.subarray(4));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Registers the wallet's account for an event straight from its Intents
 * balance: one signature, no gas. intents.near sends the USDC to the escrow
 * with `ft_transfer_call`, and the escrow registers the guest.
 */
export async function registerFromIntents(address: string, eventId: number, deposit: string): Promise<void> {
  const payload = JSON.stringify({
    signer_id: address,
    verifying_contract: INTENTS_CONTRACT,
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    nonce: await nonce(),
    intents: [
      {
        intent: "ft_withdraw",
        token: USDC_CONTRACT,
        receiver_id: EVENTS_CONTRACT,
        amount: deposit,
        msg: JSON.stringify({ action: "register", event_id: eventId, guest: address }),
      },
    ],
  });
  const hexMessage = "0x" + Array.from(new TextEncoder().encode(payload), (b) => b.toString(16).padStart(2, "0")).join("");
  const sigHex = (await ethereum().request({ method: "personal_sign", params: [hexMessage, address] })) as string;
  const sig = Uint8Array.from(sigHex.slice(2).match(/../g)!.map((h) => parseInt(h, 16)));
  if (sig[64] >= 27) sig[64] -= 27; // The verifier expects v in {0, 1}.

  const res = await fetch("/api/intents/execute", {
    method: "POST",
    body: JSON.stringify({ standard: "erc191", payload, signature: `secp256k1:${baseEncode(sig)}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Intent failed");
}

/** Asks the relayer to move this account's payout into its Intents balance. */
export async function pushPayoutToIntents(accountId: string): Promise<void> {
  const res = await fetch("/api/intents/payout", { method: "POST", body: JSON.stringify({ accountId }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Payout failed");
}
