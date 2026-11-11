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

/** Browser extensions announce themselves (EIP-6963), so a guest with two wallets can pick one. */
const extensions = new Map<string, { info: { rdns: string; name: string; icon: string }; provider: Eip1193 }>();
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e) => {
    const d = (e as CustomEvent).detail;
    if (d?.info?.rdns && d.provider) extensions.set(d.info.rdns, d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

/** The wallet this browser signed in with: an extension's rdns, or "injected" (`window.ethereum`). */
const WALLET_KEY = "near-events:evm-wallet";

export interface EvmWallet {
  id: string;
  name: string;
  icon?: string;
}

const injected = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;

/** Wallets to offer at sign-in: each extension, or the one `window.ethereum`. */
export function evmWallets(): EvmWallet[] {
  const list: EvmWallet[] = [...extensions.values()].map(({ info }) => ({ id: info.rdns, name: info.name, icon: info.icon }));
  if (!list.length && injected()) list.push({ id: "injected", name: "Browser wallet" });
  return list;
}

function savedWallet(): string | null {
  try {
    return localStorage.getItem(WALLET_KEY);
  } catch {
    return null;
  }
}

/** The one EIP-1193 provider every EVM call goes through: the wallet picked at sign-in. */
function ethereum(id = savedWallet()): Eip1193 {
  const eth = (id && extensions.get(id)?.provider) || injected();
  if (!eth) throw new Error("No EVM wallet found. Install MetaMask, Rabby or another browser wallet.");
  return eth;
}

/** Turns wallet error codes (EIP-1193) into something a guest can act on. */
function walletError(e: unknown): Error {
  const code = (e as { code?: number })?.code;
  if (code === -32002)
    return new Error("Your wallet already has a request open. Click the wallet icon in your browser, finish or close it, then try again.");
  if (code === 4001) return new Error("You declined in your wallet. Try again when ready.");
  if (code === 4902) return new Error("Your wallet doesn't have this network yet. Add it in the wallet, or pick a token on another network.");
  return e instanceof Error ? e : new Error(String((e as { message?: string })?.message ?? e));
}

// Wallets refuse a second connect while one is pending (Rabby: "Connection
// declined"), so a double click or React re-run must reuse the first request.
let connecting: Promise<string> | null = null;

/** Connects `id` (one of `evmWallets()`) and remembers it for reloads; returns the lowercase address. */
export function connectEvm(id = "injected"): Promise<string> {
  connecting ??= (async () => {
    try {
      const eth = ethereum(id);
      // Already approved for this site: no pop-up at all.
      let [address] = ((await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[]) ?? [];
      address ??= ((await eth.request({ method: "eth_requestAccounts" })) as string[])[0];
      if (!address) throw new Error("Wallet returned no address");
      try {
        localStorage.setItem(WALLET_KEY, id);
      } catch {}
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

/** Sign-out: forget the picked wallet so the next sign-in can pick another (extensions stay approved). */
export function disconnectEvm(): void {
  try {
    localStorage.removeItem(WALLET_KEY);
  } catch {}
}

/** Sends one transaction from the EVM wallet on `chainId` (switching network first); returns its hash. */
export async function sendFromEvm(chainId: number, tx: object): Promise<string> {
  const eth = ethereum();
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
    return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  } catch (e) {
    throw walletError(e);
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

/**
 * A host action (create_event, finalize or cancel) as an Intents `auth_call`: one signature, no gas.
 * The escrow's `on_auth` runs it as this account; no NEAR can ride along, so only free-tier events.
 */
export async function hostFromIntents(address: string, msg: Record<string, unknown>): Promise<void> {
  await signAndRelay(address, { intent: "auth_call", contract_id: EVENTS_CONTRACT, msg: JSON.stringify(msg) });
}

/** ERC-191 `personal_sign` of `text` by the wallet; returns the 0x signature. */
export async function personalSign(address: string, text: string): Promise<string> {
  const hexMessage = "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");
  return (await ethereum()
    .request({ method: "personal_sign", params: [hexMessage, address] })
    .catch((e) => {
      throw walletError(e);
    })) as string;
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
  const sigHex = await personalSign(address, payload);
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
