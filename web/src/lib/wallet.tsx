"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";
import { useRouter } from "next/navigation";
import { connectEvm, evmAccount } from "./intents";
import { RETURN_KEY, fastAuthEnsure, fastAuthLogin, fastAuthLogout, fastAuthPrepare, fastAuthRestore, fastAuthSend } from "./fastauth";

/** Implicit NEAR accounts from Google/email login are a 64-char hex id. */
const isImplicit = (id: string) => /^[0-9a-f]{64}$/i.test(id);

type Kind = "wallet" | "email" | "evm";
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
  /** EVM wallet; the account is the wallet's NEAR Intents account (mainnet). */
  signInWithEvm: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs and sends calls, one transaction each, in order. */
  send: (calls: Call[]) => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [ready, setReady] = useState(false);

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
      const c = new NearConnector({ network: NETWORK, footerBranding: null, excludedWallets: ["ethereum-wallets"] });
      connector.current = c;
      c.on("wallet:signIn", (t) => remember("wallet", t.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => remember(null, null));
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KIND_KEY);
      } catch {}
      fastAuthPrepare().catch(() => {});
      const returningFromAuth0 = new URLSearchParams(window.location.search).has("code");
      if (saved === "evm") {
        const id = await evmAccount();
        if (!cancelled && id) remember("evm", id);
      } else if (saved === "email" || returningFromAuth0) {
        const id = await fastAuthRestore();
        if (!cancelled && id) remember("email", id);
        const back = sessionStorage.getItem(RETURN_KEY);
        if (back) {
          sessionStorage.removeItem(RETURN_KEY);
          router.replace(back);
        }
      } else {
        try {
          const wallet = await c.wallet();
          const accounts = await wallet.getAccounts();
          if (!cancelled && accounts[0]) remember("wallet", accounts[0].accountId);
        } catch {
          // Not signed in yet.
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const signInWithEmail = useCallback(async () => {
    const id = await fastAuthLogin();
    remember("email", id);
  }, []);

  const signInWithEvm = useCallback(async () => {
    remember("evm", await connectEvm());
  }, []);

  const signOut = useCallback(async () => {
    if (kind === "email") await fastAuthLogout();
    else await connector.current?.disconnect().catch(() => {});
    remember(null, null);
  }, [kind]);

  const send = useCallback(async (calls: Call[]) => {
    if (!accountId) throw new Error("Sign in first.");

    // Google/email (or a stale session that still shows an implicit account id).
    const useEmail = kind === "email" || (kind == null && isImplicit(accountId));
    if (useEmail) {
      await fastAuthEnsure();
      for (const call of calls) await fastAuthSend(call);
      return;
    }
    if (kind === "evm") throw new Error("EVM wallets act through NEAR Intents; this action needs a NEAR account.");

    const c = connector.current;
    if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
    const wallet = await c.wallet();
    const accounts = await wallet.getAccounts().catch(() => []);
    const signerId = accounts[0]?.accountId ?? accountId;
    if (!signerId) throw new Error("Wallet session expired. Sign in again.");

    // Wallets that build the NEAR tx client-side need signerId; without it
    // near-api-js throws "Expected string not undefined at value.signerId".
    await wallet.signAndSendTransactions({
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
    });
  }, [kind, accountId]);

  return (
    <WalletContext.Provider value={{ accountId, kind, ready, signIn, signInWithEmail, signInWithEvm, signOut, send }}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
