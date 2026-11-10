"use client";

// Guests who sign in with an EVM wallet (MetaMask, Rabby, Coinbase…). Their
// Nearvent account is their NEAR Intents account: the lowercase 0x address.
// They never hold NEAR: they sign intents with their wallet (ERC-191) and our
// relayer submits them to intents.near, paying the gas.
import { baseEncode } from "near-api-js";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "./config";
import { events, view } from "./near";
import type { Call } from "./wallet";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function ethereum(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask, Rabby or another browser wallet.");
  return eth;
}

/** Turns wallet error codes (EIP-1193) into something a guest can act on. */
function walletError(e: unknown): Error {
  const code = (e as { code?: number })?.code;
  if (code === -32002)
    return new Error("Your wallet already has a request open. Click the wallet icon in your browser, finish or close it, then try again.");
  if (code === 4001) return new Error("You declined in your wallet. Try again when ready.");
  return e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e));
}

// Wallets refuse a second connect while one is pending (Rabby: "Connection
// declined"), so a double click or React re-run must reuse the first request.
let connecting: Promise<string> | null = null;

export function connectEvm(): Promise<string> {
  connecting ??= (async () => {
    try {
      const eth = ethereum();
      // Already approved for this site: no pop-up at all.
      const [known] = ((await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[]) ?? [];
      if (known) return known.toLowerCase();
      const [address] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!address) throw new Error("Wallet returned no address");
      return address.toLowerCase();
    } catch (e) {
      throw walletError(e);
    }
  })().finally(() => {
    connecting = null;
  });
  return connecting;
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
export async function registerFromIntents(address: string, eventId: number, deposit: string, name?: string): Promise<void> {
  // The guest's display name rides along: the server saves it once the signed registration lands, so no extra prompt.
  await signAndRelay(address, {
    intent: "ft_withdraw",
    token: USDC_CONTRACT,
    receiver_id: EVENTS_CONTRACT,
    amount: deposit,
    msg: JSON.stringify({ action: "register", event_id: eventId, guest: address }),
  }, name);
}

export function withdrawIntentsCall(receiverId: string, amount: string, msg?: string): Call {
  if (!INTENTS_CONTRACT) throw new Error("NEAR Intents is not configured.");
  return {
    receiverId: INTENTS_CONTRACT, methodName: "ft_withdraw",
    args: { token: USDC_CONTRACT, receiver_id: receiverId, amount, msg: msg ?? null },
    deposit: 1n, gas: 200_000_000_000_000n,
  };
}

export async function confirmRegistration(eventId: number, accountId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (await events.guestStatus(eventId, accountId)) return;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Your place has not been confirmed. Check the event and your balance before trying again.");
}

/**
 * Moves USDC from the wallet's Intents balance to another Intents account:
 * a 1Click deposit address (quote with depositType INTENTS, which 1Click then
 * swaps and sends to the chosen chain) or any Intents wallet. One signature, no gas.
 */
export async function transferFromIntents(address: string, depositAddress: string, amount: string): Promise<void> {
  await signAndRelay(address, { intent: "transfer", receiver_id: depositAddress, tokens: { [`nep141:${USDC_CONTRACT}`]: amount } });
}

/** Signs one intent with the EVM wallet (ERC-191); our relayer submits it to intents.near. */
async function signAndRelay(address: string, intent: Record<string, unknown>, name?: string): Promise<void> {
  const payload = JSON.stringify({
    signer_id: address,
    verifying_contract: INTENTS_CONTRACT,
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    nonce: await nonce(),
    intents: [intent],
  });
  const hexMessage = "0x" + Array.from(new TextEncoder().encode(payload), (b) => b.toString(16).padStart(2, "0")).join("");
  const sigHex = (await ethereum()
    .request({ method: "personal_sign", params: [hexMessage, address] })
    .catch((e) => {
      throw walletError(e);
    })) as string;
  const sig = Uint8Array.from(sigHex.slice(2).match(/../g)!.map((h) => parseInt(h, 16)));
  if (sig[64] >= 27) sig[64] -= 27; // The verifier expects v in {0, 1}.

  const res = await fetch("/api/intents/execute", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ standard: "erc191", payload, signature: `secp256k1:${baseEncode(sig)}`, name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Intent failed");
}

/** Asks the relayer to move this account's payout into its Intents balance. */
export async function pushPayoutToIntents(accountId: string, amount: string): Promise<void> {
  const res = await fetch("/api/intents/payout", { method: "POST", body: JSON.stringify({ accountId, amount }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Payout failed");
}
