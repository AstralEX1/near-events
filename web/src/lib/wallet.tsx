"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";
import { useRouter } from "next/navigation";
import { RETURN_KEY, fastAuthLogin, fastAuthLogout, fastAuthPrepare, fastAuthRestore, fastAuthSend } from "./fastauth";

type Kind = "wallet" | "email";
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
      const c = new NearConnector({ network: NETWORK, footerBranding: null });
      connector.current = c;
      c.on("wallet:signIn", (t) => remember("wallet", t.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => remember(null, null));
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KIND_KEY);
      } catch {}
      fastAuthPrepare().catch(() => {});
      const returningFromAuth0 = new URLSearchParams(window.location.search).has("code");
      if (saved === "email" || returningFromAuth0) {
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

  const signOut = useCallback(async () => {
    if (kind === "email") await fastAuthLogout();
    else await connector.current?.disconnect().catch(() => {});
    remember(null, null);
  }, [kind]);

  const send = useCallback(async (calls: Call[]) => {
    if (kind === "email") {
      for (const call of calls) await fastAuthSend(call);
      return;
    }
    const c = connector.current;
    if (!c) throw new Error("Wallet is still loading");
    const wallet = await c.wallet();
    await wallet.signAndSendTransactions({
      transactions: calls.map((call) => ({
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
  }, [kind]);

  return (
    <WalletContext.Provider value={{ accountId, kind, ready, signIn, signInWithEmail, signOut, send }}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
