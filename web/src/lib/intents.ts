"use client";

// Guests who sign in with an EVM wallet (MetaMask, Rabby, Coinbase…). Their
// Nearvent account is their NEAR Intents account: the lowercase 0x address.
// They never hold NEAR: they sign intents with their wallet (ERC-191) and our
// relayer submits them to intents.near, paying the gas.
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "./config";
import { events, view } from "./near";
import { moveProblem, versionedNonce } from "./nearcomShared";
import { oneClickCall, USDC_ASSET } from "./oneclickClient";
import type { Call } from "./wallet";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
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

/** Follows account switches in the signed-in EVM wallet (EIP-1193 `accountsChanged`): the new address, or null when the site is disconnected. */
export function watchEvmAccount(onChange: (address: string | null) => void): () => void {
  let eth: Eip1193;
  try {
    eth = ethereum();
  } catch {
    return () => {};
  }
  const handler = (accounts: unknown) => onChange((accounts as string[] | undefined)?.[0]?.toLowerCase() ?? null);
  eth.on?.("accountsChanged", handler);
  return () => eth.removeListener?.("accountsChanged", handler);
}

/** Sign-out: forget the picked wallet so the next sign-in can pick another (extensions stay approved). */
export function disconnectEvm(): void {
  try {
    localStorage.removeItem(WALLET_KEY);
  } catch {}
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

/** Locks a Deposit event's host bond from the wallet's Intents balance (anyone may pay it; it belongs to the host). */
export async function bondFromIntents(address: string, eventId: number, amount: string): Promise<void> {
  await signAndRelay(address, {
    intent: "ft_withdraw",
    token: USDC_CONTRACT,
    receiver_id: EVENTS_CONTRACT,
    amount,
    msg: JSON.stringify({ action: "host_bond", event_id: eventId }),
  });
}

/** Opens a dispute about `target`'s record, paying the bond (one deposit) from the wallet's Intents balance. */
export async function disputeFromIntents(address: string, eventId: number, target: string, attended: boolean, bond: string): Promise<void> {
  await signAndRelay(address, {
    intent: "ft_withdraw",
    token: USDC_CONTRACT,
    receiver_id: EVENTS_CONTRACT,
    amount: bond,
    msg: JSON.stringify({ action: "dispute", event_id: eventId, target, attended, guest: address }),
  });
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
  const res = await fetch("/api/intents/execute", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ standard: "erc191", payload, signature: await erc191Signature(address, payload), name }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Intent failed");
}

/** The wallet's `personal_sign` of `text` in the verifier's form: secp256k1:<base58 r‖s‖v>. */
async function erc191Signature(address: string, text: string): Promise<string> {
  const sigHex = await personalSign(address, text);
  const sig = Uint8Array.from(sigHex.slice(2).match(/../g)!.map((h) => parseInt(h, 16)));
  if (sig[64] >= 27) sig[64] -= 27; // The verifier expects v in {0, 1}.
  // Loaded here, not at the top: this file ships on every page and near-api-js is ~480 KB.
  const { baseEncode } = await import("near-api-js");
  return `secp256k1:${baseEncode(sig)}`;
}

// Most NEAR Intents money (near.com's default) sits on Confidential Intents, which has no
// public RPC. "Sign In with NEAR Intents" is one wallet signature for a 15-minute 1Click
// session that reads it; paying then moves what's missing to the public balance (one more
// signature), where the usual registration takes it.

/** NEP-413 signing by a NEAR wallet (`useWallet().signMessage`); without it the guest signs ERC-191 (EVM wallets). */
export type Nep413Sign = (message: string, recipient: string, nonce: Uint8Array) => Promise<{ publicKey: string; signature: string }>;

const sessionKey = (account: string) => `near-events:intents-session:${account}`;

/** A 1Click session from an earlier sign-in that still has a minute left, or null. */
export function savedIntentsSession(account: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(sessionKey(account)) ?? "null") as { token: string; until: number } | null;
    if (saved && saved.until > Date.now()) return saved.token;
  } catch {}
  return null;
}

export function forgetIntentsSession(account: string) {
  try { localStorage.removeItem(sessionKey(account)); } catch {}
}

const base64Bytes = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

/** 1Click `signedData` for `message` (the intent JSON) signed as `account`. */
async function signedForOneClick(account: string, message: string, nonce: string, nep413?: Nep413Sign, recipient = INTENTS_CONTRACT!) {
  if (!nep413) return { standard: "erc191", payload: message, signature: await erc191Signature(account, message) };
  const { publicKey, signature } = await nep413(message, recipient, base64Bytes(nonce));
  const { baseEncode } = await import("near-api-js");
  return {
    standard: "nep413",
    payload: { recipient, nonce, message },
    public_key: publicKey,
    // Wallets return base64; some already give ed25519:<base58>, which 1Click wants.
    signature: signature.startsWith("ed25519:") ? signature : `ed25519:${baseEncode(base64Bytes(signature))}`,
  };
}

/** Signs the guest in to NEAR Intents (one signature) and keeps the session for its 15 minutes. */
export async function signInToIntents(account: string, nep413?: Nep413Sign): Promise<string> {
  const deadline = new Date(Date.now() + 5 * 60_000);
  const nonce = versionedNonce(await view<string>("current_salt", {}, INTENTS_CONTRACT!), deadline);
  // An empty intent proves the wallet owns the account and moves nothing.
  const intent = { deadline: deadline.toISOString(), intents: [], signer_id: account };
  const message = JSON.stringify(nep413 ? intent : { signer_id: account, verifying_contract: INTENTS_CONTRACT, deadline: intent.deadline, nonce, intents: [] });
  const signedData = await signedForOneClick(account, message, nonce, nep413);
  const { accessToken, expiresIn } = await oneClickCall<{ accessToken: string; expiresIn?: number }>("auth/authenticate", { signedData });
  try {
    localStorage.setItem(sessionKey(account), JSON.stringify({ token: accessToken, until: Date.now() + ((expiresIn ?? 900) - 60) * 1000 }));
  } catch {}
  return accessToken;
}

/** USDC on the account's Confidential Intents balance. */
export async function confidentialUsdc(session: string): Promise<bigint> {
  const { balances } = await oneClickCall<{ balances: { tokenId: string; available: string }[] }>(
    `account/balances?tokenIds=${encodeURIComponent(USDC_ASSET)}`, undefined, session);
  return balances.filter((b) => b.tokenId === USDC_ASSET).reduce((sum, b) => sum + BigInt(b.available), 0n);
}

/** One signature: moves `amount` USDC from Confidential to the account's public Intents balance and waits for it. */
export async function moveFromConfidential(account: string, session: string, amount: bigint, nep413?: Nep413Sign): Promise<void> {
  const before = await intentsUsdcBalance(account);
  const { quote } = await oneClickCall<{ quote: { depositAddress: string; amountIn: string } }>("quote", {
    dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 0,
    originAsset: USDC_ASSET, destinationAsset: USDC_ASSET, amount: amount.toString(),
    depositType: "CONFIDENTIAL_INTENTS", recipient: account, recipientType: "INTENTS",
    refundTo: account, refundType: "CONFIDENTIAL_INTENTS",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(), referral: "near-events",
  }, session);
  const { intent } = await oneClickCall<{ intent: { payload?: unknown } }>("generate-intent", {
    type: "swap_transfer", standard: nep413 ? "nep413" : "erc191", signerId: account, depositAddress: quote.depositAddress,
  }, session);
  // ERC-191 payloads are the intent JSON; NEP-413 ones wrap it with its nonce.
  const payload = intent?.payload as string | { message?: string; nonce?: string; recipient?: string } | undefined;
  const wrapper = typeof payload === "object" ? payload : {};
  const message = typeof payload === "string" ? payload : wrapper.message ?? "";
  const problem = moveProblem(message, { signer: account, depositAddress: quote.depositAddress, amountIn: quote.amountIn, usdc: USDC_CONTRACT })
    ?? (nep413 && (!wrapper.nonce || !wrapper.recipient) ? "no NEP-413 nonce or recipient" : null);
  if (problem) throw new Error(`NEAR Intents asked to sign something unexpected (${problem}), so nothing was signed.`);
  const signedData = await signedForOneClick(account, message, wrapper.nonce ?? "", nep413, wrapper.recipient);
  await oneClickCall("submit-intent", { type: "swap_transfer", signedData }, session);
  // The public balance is the proof: wait until the USDC lands there.
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (await intentsUsdcBalance(account).catch(() => 0n) >= before + amount) return;
  }
  throw new Error("Your USDC is still on its way to your NEAR Intents balance. Wait a minute, then press the button again.");
}

/** Asks the relayer to move this account's payout into its Intents balance. */
export async function pushPayoutToIntents(accountId: string, amount: string): Promise<void> {
  const res = await fetch("/api/intents/payout", { method: "POST", body: JSON.stringify({ accountId, amount }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Payout failed");
}
