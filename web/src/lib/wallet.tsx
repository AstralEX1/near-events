"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK } from "./config";

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
  ready: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Signs and sends calls, one transaction each, in order. */
  send: (calls: Call[]) => Promise<void>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const connector = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({ network: NETWORK, footerBranding: null });
      connector.current = c;
      c.on("wallet:signIn", (t) => setAccountId(t.accounts[0]?.accountId ?? null));
      c.on("wallet:signOut", () => setAccountId(null));
      try {
        const wallet = await c.wallet();
        const accounts = await wallet.getAccounts();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // Not signed in yet.
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async () => {
    await connector.current?.connect();
  }, []);

  const signOut = useCallback(async () => {
    await connector.current?.disconnect();
    setAccountId(null);
  }, []);

  const send = useCallback(async (calls: Call[]) => {
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
  }, []);

  return (
    <WalletContext.Provider value={{ accountId, ready, signIn, signOut, send }}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
