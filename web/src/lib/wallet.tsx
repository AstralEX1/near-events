"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { EVENTS_CONTRACT, NETWORK } from "./config";
import { STAFF_MESSAGE, evmStaffMessage } from "./staffShared";
import { useRouter } from "next/navigation";
import { connectEvm, disconnectEvm, evmAccount, hostFromIntents, personalSign, watchEvmAccount } from "./intents";
import { FREE_MAX_CAPACITY, FREE_MAX_DAYS, FREE_MAX_EVENTS } from "./near";
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
   * A server token for signed-in saves (free events, RSVPs, names, door check-in).
   * NEAR wallets sign one message during sign-in; Google/email proves once with an
   * unsent transaction; EVM wallets sign one message the first time it is needed.
   * The token is reused for 30 days.
   */
  staffToken: () => Promise<string>;
  /** NEP-413 signature by the NEAR wallet (kind "wallet") of `message` for `recipient`; no transaction. */
  signMessage: (message: string, recipient: string, nonce: Uint8Array) => Promise<{ publicKey: string; signature: string }>;
}

const tokenKey = (accountId: string) => `near-events:staff:${accountId}`;

/** The server token from an earlier proof (30 days) so later actions never ask the wallet again. */
export function savedStaffToken(accountId: string): string | null {
  try {
    const saved = JSON.parse(localStorage.getItem(tokenKey(accountId)) ?? "null") as { token: string; until: number } | null;
    if (saved && saved.until > Date.now()) return saved.token;
  } catch {}
  return null;
}

async function exchangeProof(proof: object, accountId: string): Promise<string> {
  const res = await fetch("/api/checkin/session", { method: "POST", body: JSON.stringify(proof) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not sign in");
  if (json.accountId !== accountId) throw new Error(`The wallet signed as ${json.accountId}, not ${accountId}.`);
  try {
    // The token carries its own expiry (account.exp.sig); refresh an hour early.
    localStorage.setItem(tokenKey(accountId), JSON.stringify({ token: json.token, until: Number(String(json.token).split(".")[1]) * 1000 - 60 * 60 * 1000 }));
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

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [ready, setReady] = useState(false);
  /** True only while the user is picking a wallet, so a restored old wallet session can't replace a Google/email sign-in. */
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
      });
      connector.current = c;
      c.on("wallet:signIn", (t) => {
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(KIND_KEY);
        } catch {}
        if ((saved === "email" || saved === "demo") && !connecting.current) return;
        const userPicked = connecting.current;
        connecting.current = false;
        fastAuthLogout().catch(() => {});
        const id = t.accounts[0]?.accountId ?? null;
        remember("wallet", id);
        // Prove the account as part of sign-in, so creating events, RSVPs and saves never open the wallet later.
        if (userPicked && id && !savedStaffToken(id)) proveWallet(c, id).catch(() => {});
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
        const id = await evmAccount();
        if (!cancelled && id) restore("evm", id);
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
          if (!cancelled && accounts[0]) restore("wallet", accounts[0].accountId);
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

  // Switching account in the wallet switches it here too, as on other dApps. EVM wallets announce it
  // (accountsChanged); NEAR Connect has no such event, so NEAR wallets are re-read when the tab gets focus.
  useEffect(() => {
    if (kind === "evm") {
      return watchEvmAccount((address) => {
        if (!address) disconnectEvm();
        remember(address ? "evm" : null, address);
      });
    }
    if (kind !== "wallet") return;
    const check = async () => {
      const wallet = await connector.current?.wallet().catch(() => null);
      const id = (await wallet?.getAccounts().catch(() => null))?.[0]?.accountId;
      if (id && id !== accountId) remember("wallet", id);
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accountId]);

  const signIn = useCallback(async () => {
    connecting.current = true;
    await connector.current?.connect().catch((e) => {
      connecting.current = false;
      throw e;
    });
  }, []);

  const signInWithEmail = useCallback(async () => {
    // Drop any old wallet session so its account can't take over this one.
    await connector.current?.disconnect().catch(() => {});
    const id = await fastAuthLogin();
    remember("email", id);
  }, []);

  const signInWithEvm = useCallback(async (wallet?: string) => {
    remember("evm", await connectEvm(wallet));
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

    if (kind === "email" || (kind == null && isImplicit(accountId))) {
      return exchangeProof({ mpc: await fastAuthProve() }, accountId);
    }
    if (kind === "wallet") {
      const c = connector.current;
      if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
      return proveWallet(c, accountId);
    }
    if (kind === "evm") {
      const at = Date.now();
      const signature = await personalSign(accountId, evmStaffMessage(accountId, at));
      return exchangeProof({ evm: { address: accountId, at, signature } }, accountId);
    }
    throw new Error("Sign out and sign in again.");
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
