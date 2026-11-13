"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { EVENTS_CONTRACT, NETWORK } from "./config";
import { STAFF_MESSAGE, evmStaffMessage } from "./staffShared";
import { useRouter } from "next/navigation";
import { connectEvm, disconnectEvm, evmAccount, hostFromIntents, personalSign, watchEvmAccount } from "./intents";
import { FREE_MAX_CAPACITY, FREE_MAX_DAYS, FREE_MAX_EVENTS } from "./near";
import { toast } from "@/components/SlUi";
import { RETURN_KEY, fastAuthEnsure, fastAuthLogin, fastAuthLogout, fastAuthProve, fastAuthRestore, fastAuthSend } from "./fastauth";
import { demoLogin, demoLogout, demoRestore, demoSend } from "./demoBackend";

/** Implicit NEAR accounts from Google/email login are a 64-char hex id. */
const isImplicit = (id: string) => /^[0-9a-f]{64}$/i.test(id);

/**
 * A named account from the other network (e.g. `name.near` while the site runs
 * on testnet). Wallets can stay signed in to mainnet; the transaction then goes
 * to testnet, where that account and its key don't exist, and the wallet only
 * says "access key ... doesn't exist".
 */
function wrongNetwork(id: string): boolean {
  if (isImplicit(id) || /^0x[0-9a-f]{40}$/i.test(id)) return false;
  return NETWORK === "testnet" ? !id.endsWith(".testnet") : id.endsWith(".testnet");
}
const wrongNetworkMessage = (id: string) =>
  `${id} is on a different NEAR network than this site. ` +
  `Sign out, switch your wallet to the network this site uses, and sign in again.`;

type Kind = "wallet" | "email" | "evm" | "demo";
const KIND_KEY = "near-events:login";

const TGAS = 1_000_000_000_000n;

export interface Call {
  receiverId: string;
  methodName: string;
  args: object;
  deposit?: bigint;
  gas?: bigint;
}

interface WalletState {
  accountId: string | null;
  /** How the user signed in: a NEAR wallet, or Google/email via NEAR Auth. */
  kind: Kind | null;
  ready: boolean;
  /** Opens the wallet picker. */
  signIn: () => Promise<void>;
  /** Google / email / passkey via NEAR Auth. */
  signInWithEmail: () => Promise<void>;
  /** EVM wallet (one of `evmWallets()`); the account is the wallet's NEAR Intents account. */
  signInWithEvm: (wallet?: string) => Promise<void>;
  /** Demo mode: made-up events and money kept in this browser; nothing reaches the server or the chain. */
  signInWithDemo: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs and sends calls, one transaction each, in order. */
  send: (calls: Call[]) => Promise<void>;
  /**
   * The 1-day session token for signed-in saves (free events, RSVPs, names, profile, door check-in).
   * NEAR and EVM wallets get it at sign-in (one signed message); Google/email proves the first time
   * it is needed (an unsent transaction). After a day the next save asks the wallet once more.
   */
  staffToken: () => Promise<string>;
  /** NEP-413 signature by the NEAR wallet (kind "wallet") of `message` for `recipient`; no transaction. */
  signMessage: (message: string, recipient: string, nonce: Uint8Array) => Promise<{ publicKey: string; signature: string }>;
}

// "session", not the old "staff" key: tokens saved under that one are 30-day ones the server now refuses.
const tokenKey = (accountId: string) => `near-events:session:${accountId}`;

/** The session token from sign-in (1 day), so later actions never ask the wallet again. */
export function savedStaffToken(accountId: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(tokenKey(accountId)) ?? "null") as { token: string; until: number } | null;
    if (saved && saved.until > Date.now()) return saved.token;
  } catch {}
  return null;
}

/** Accounts signed in on this device with a token still valid (sign-out drops it): the wallets that can be linked here. */
export function savedAccounts(): string[] {
  try {
    const prefix = tokenKey("");
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).filter(savedStaffToken);
  } catch {
    return [];
  }
}

async function exchangeProof(proof: object, accountId: string): Promise<string> {
  const res = await fetch("/api/checkin/session", { method: "POST", body: JSON.stringify(proof) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not sign in");
  if (json.accountId !== accountId) throw new Error(`The wallet signed as ${json.accountId}, not ${accountId}.`);
  try {
    // The token carries its own expiry (account.exp.sig); renew a few minutes early.
    localStorage.setItem(tokenKey(accountId), JSON.stringify({ token: json.token, until: Number(String(json.token).split(".")[1]) * 1000 - 5 * 60 * 1000 }));
  } catch {}
  return json.token as string;
}

/** NEP-413 message signed by the wallet: proves the account to our server. No transaction. */
async function proveWallet(c: NearConnector, accountId: string): Promise<string> {
  const wallet = await c.wallet();
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()));
  const signed = await wallet.signMessage({ message: STAFF_MESSAGE, recipient: EVENTS_CONTRACT, nonce });
  if (!signed) throw new Error("The wallet did not sign the message.");
  return exchangeProof({
    wallet: { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: btoa(String.fromCharCode(...nonce)) },
  }, accountId);
}

/** One signed message (no transaction) that proves `accountId` to our server; returns the session token. */
function prove(k: Kind | null, accountId: string, c: NearConnector | null): Promise<string> {
  if (k === "email") return fastAuthProve().then((mpc) => exchangeProof({ mpc }, accountId));
  if (k === "wallet") {
    if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
    return proveWallet(c, accountId);
  }
  if (k === "evm") {
    const at = Date.now();
    return personalSign(accountId, evmStaffMessage(accountId, at)).then((signature) => exchangeProof({ evm: { address: accountId, at, signature } }, accountId));
  }
  throw new Error("Sign out and sign in again.");
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [ready, setReady] = useState(false);
  /** True while signIn() connects the wallet the user picked; it finishes that sign-in itself. */
  const connecting = useRef(false);

  const remember = (k: Kind | null, id: string | null) => {
    setKind(k);
    setAccountId(id);
    try {
      if (k) localStorage.setItem(KIND_KEY, k);
      else localStorage.removeItem(KIND_KEY);
    } catch {
      // Storage unavailable: the session just won't survive a reload.
    }
  };

  /**
   * Sign-in = the wallet connection plus one signed message (the 1-day session). Without that
   * signature nobody is signed in: a decline disconnects the wallet again. An account with a live
   * session on this device signs in without a prompt.
   */
  const signInAs = useRef(async (k: "wallet" | "evm", id: string) => {
    if (!savedStaffToken(id)) {
      // Until the new account signs, nobody is signed in: an old account's session never stands in for it.
      remember(null, null);
      try {
        if (k === "wallet" && wrongNetwork(id)) throw new Error(wrongNetworkMessage(id));
        await prove(k, id, connector.current);
      } catch (e) {
        if (k === "evm") disconnectEvm();
        else await connector.current?.disconnect().catch(() => {});
        throw e;
      }
    }
    if (k === "wallet") fastAuthLogout().catch(() => {});
    remember(k, id);
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      // "Ethereum Wallets" maps an EVM wallet to a different NEAR account and has no
      // testnet; EVM wallets sign in through our own NEAR Intents path instead.
      const c = new NearConnector({
        network: NETWORK,
        footerBranding: null,
        excludedWallets: ["ethereum-wallets"],
        // Sign-in is a signed message, so only wallets that can sign one are offered.
        features: { signMessage: true },
      });
      connector.current = c;
      c.on("wallet:signIn", (t) => {
        // A connect the user started is finished by signIn(); this catches the rest (a wallet's own in-app browser).
        if (connecting.current) return;
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(KIND_KEY);
        } catch {}
        if (saved === "email" || saved === "demo") return;
        const id = t.accounts[0]?.accountId;
        if (id) signInAs.current("wallet", id).catch(() => {});
      });
      c.on("wallet:signOut", () => remember(null, null));
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KIND_KEY);
      } catch {}
      const returningFromAuth0 = new URLSearchParams(window.location.search).has("code");
      // A transition lets the page finish hydrating before the restored account re-renders it
      // (an urgent update here breaks hydration of the signed-out server HTML).
      const restore = (k: Kind, id: string) => startTransition(() => remember(k, id));
      if (saved === "demo") {
        const id = demoRestore();
        if (!cancelled && id) restore("demo", id);
      } else if (saved === "evm") {
        // A wallet still connected but without a live session (over a day old) is signed out: Sign In asks once.
        const id = await evmAccount();
        if (!cancelled && id && savedStaffToken(id)) restore("evm", id);
      } else if (saved === "email" || returningFromAuth0) {
        const id = await fastAuthRestore();
        if (!cancelled && id) restore("email", id);
        const back = returningFromAuth0 ? sessionStorage.getItem(RETURN_KEY) : null;
        if (back) {
          sessionStorage.removeItem(RETURN_KEY);
          router.replace(back);
        }
      } else {
        try {
          const wallet = await c.wallet();
          const accounts = await wallet.getAccounts();
          if (!cancelled && accounts[0] && savedStaffToken(accounts[0].accountId)) restore("wallet", accounts[0].accountId);
        } catch {
          // Not signed in yet.
        }
      }
      if (!cancelled) startTransition(() => setReady(true));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching account in the wallet signs in as that account, as on other dApps. EVM wallets announce it
  // (accountsChanged); NEAR Connect has no such event, so NEAR wallets are re-read when the tab gets focus.
  useEffect(() => {
    if (kind === "evm") {
      return watchEvmAccount((address) => {
        if (address === accountId) return;
        if (address) signInAs.current("evm", address).catch(() => {});
        else {
          disconnectEvm();
          remember(null, null);
        }
      });
    }
    if (kind !== "wallet") return;
    const check = async () => {
      const wallet = await connector.current?.wallet().catch(() => null);
      const id = (await wallet?.getAccounts().catch(() => null))?.[0]?.accountId;
      if (id && id !== accountId) signInAs.current("wallet", id).catch(() => {});
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accountId]);

  const signIn = useCallback(async () => {
    const c = connector.current;
    if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
    connecting.current = true;
    try {
      const wallet = await c.connect();
      const id = (await wallet.getAccounts())[0]?.accountId;
      if (!id) throw new Error("The wallet returned no account. Try again.");
      await signInAs.current("wallet", id);
    } finally {
      connecting.current = false;
    }
  }, []);

  const signInWithEmail = useCallback(async () => {
    // Drop any old wallet session so its account can't take over this one.
    await connector.current?.disconnect().catch(() => {});
    const id = await fastAuthLogin();
    remember("email", id);
  }, []);

  const signInWithEvm = useCallback(async (wallet?: string) => {
    await signInAs.current("evm", await connectEvm(wallet));
  }, []);

  const signInWithDemo = useCallback(async (next?: string) => {
    await connector.current?.disconnect().catch(() => {});
    remember("demo", demoLogin());
    // A full load: every page re-reads from the demo data.
    if (next) window.location.replace(next);
    else window.location.reload();
  }, []);

  const signOut = useCallback(async () => {
    try {
      if (accountId) localStorage.removeItem(tokenKey(accountId));
    } catch {}
    if (kind === "demo") demoLogout();
    else if (kind === "email") await fastAuthLogout();
    else if (kind === "evm") disconnectEvm();
    else await connector.current?.disconnect().catch(() => {});
    remember(null, null);
    if (kind === "demo") window.location.reload(); // back to the real events
  }, [kind, accountId]);

  const send = useCallback(
    async (calls: Call[]) => {
      if (!accountId) throw new Error("Sign in first.");

      // Demo mode: changes the made-up data in this browser, no prompt.
      if (kind === "demo") {
        for (const call of calls) await demoSend(call);
        return;
      }

      // Google/email (or a stale session that still shows an implicit account id).
      const useEmail = kind === "email" || (kind == null && isImplicit(accountId));
      if (useEmail) {
        await fastAuthEnsure();
        for (const call of calls) await fastAuthSend(call);
        return;
      }
      // EVM wallets act on the escrow through NEAR Intents (`auth_call` → `on_auth`); the relayer pays the gas.
      if (kind === "evm") {
        for (const call of calls) {
          if (call.receiverId !== EVENTS_CONTRACT || !["create_event", "finalize", "cancel"].includes(call.methodName)) {
            throw new Error("EVM wallets can't do this here. Sign in with Google or a NEAR wallet.");
          }
          if (call.methodName === "create_event" && (call.deposit ?? 0n) > 0n) {
            throw new Error(`EVM wallets can create free-tier events only: up to ${FREE_MAX_CAPACITY} seats, ${FREE_MAX_EVENTS} in 30 days, ending within ${FREE_MAX_DAYS} days.`);
          }
          await hostFromIntents(accountId, { action: call.methodName, ...call.args });
        }
        return;
      }

      const c = connector.current;
      if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
      const wallet = await c.wallet();
      const accounts = await wallet.getAccounts().catch(() => []);
      const signerId = accounts[0]?.accountId;
      if (!signerId) {
        // No live wallet session. A Google/email account id means that login is the real one.
        if (isImplicit(accountId)) {
          remember("email", accountId);
          await fastAuthEnsure();
          for (const call of calls) await fastAuthSend(call);
          return;
        }
        throw new Error("Wallet session expired. Sign out and connect your wallet again.");
      }
      if (wrongNetwork(signerId)) throw new Error(wrongNetworkMessage(signerId));

      // Wallets that build the NEAR tx client-side need signerId; without it
      // near-api-js throws "Expected string not undefined at value.signerId".
      await wallet
        .signAndSendTransactions({
          transactions: calls.map((call) => ({
            signerId,
            receiverId: call.receiverId,
            actions: [
              {
                type: "FunctionCall" as const,
                params: {
                  methodName: call.methodName,
                  args: call.args as Record<string, unknown>,
                  gas: (call.gas ?? 100n * TGAS).toString(),
                  deposit: (call.deposit ?? 0n).toString(),
                },
              },
            ],
          })),
        })
        .catch((e: unknown) => {
          if (/signerId/.test(String(e))) throw new Error("Wallet session expired. Sign out and connect your wallet again.");
          throw e;
        });
    },
    [kind, accountId],
  );

  const staffToken = useCallback(async () => {
    if (!accountId) throw new Error("Sign in first.");
    if (kind === "demo") return "demo"; // the demo's fake server trusts the demo account
    const saved = savedStaffToken(accountId);
    if (saved) return saved;

    const k = kind ?? (isImplicit(accountId) ? "email" : null);
    // A wallet session started over a day ago (this tab stayed open): one signature renews it.
    if (k === "wallet" || k === "evm") toast("Your sign-in ended after a day", "Sign the message in your wallet to continue. It's free.", "info");
    return prove(k, accountId, connector.current);
  }, [kind, accountId]);

  const signMessage = useCallback(async (message: string, recipient: string, nonce: Uint8Array) => {
    const c = connector.current;
    if (kind !== "wallet" || !c) throw new Error("Sign in with a NEAR wallet first.");
    const signed = await (await c.wallet()).signMessage({ message, recipient, nonce });
    if (!signed) throw new Error("The wallet did not sign the message.");
    return { publicKey: signed.publicKey, signature: signed.signature };
  }, [kind]);

  return (
    <WalletContext.Provider
      value={{
        accountId,
        kind,
        ready,
        signIn,
        signInWithEmail,
        signInWithEvm,
        signInWithDemo,
        signOut,
        send,
        staffToken,
        signMessage,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
