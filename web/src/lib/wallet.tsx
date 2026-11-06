"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { EVENTS_CONTRACT, NETWORK } from "./config";
import { STAFF_MESSAGE } from "./staffShared";
import { useRouter } from "next/navigation";
import { connectEvm, evmAccount } from "./intents";
import { RETURN_KEY, fastAuthEnsure, fastAuthLogin, fastAuthLogout, fastAuthPrepare, fastAuthProve, fastAuthRestore, fastAuthSend } from "./fastauth";

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
  `${id} is a ${NETWORK === "testnet" ? "mainnet" : "testnet"} account, but this site runs on ${NETWORK}. ` +
  `Sign out, switch your wallet to ${NETWORK} and sign in with a ${NETWORK === "testnet" ? "name.testnet" : "name.near"} account.`;

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
  /**
   * A server token for door check-in (host / co-host). Asks the wallet to sign
   * a message once (Google/email: an unsent transaction), then reuses it.
   */
  staffToken: () => Promise<string>;
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
        if (saved === "email" && !connecting.current) return;
        connecting.current = false;
        fastAuthLogout().catch(() => {});
        remember("wallet", t.accounts[0]?.accountId ?? null);
      });
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
        const back = returningFromAuth0 ? sessionStorage.getItem(RETURN_KEY) : null;
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

  const signInWithEvm = useCallback(async () => {
    remember("evm", await connectEvm());
  }, []);

  const signOut = useCallback(async () => {
    if (kind === "email") await fastAuthLogout();
    else await connector.current?.disconnect().catch(() => {});
    remember(null, null);
  }, [kind]);

  const send = useCallback(
    async (calls: Call[]) => {
      if (!accountId) throw new Error("Sign in first.");

      // Google/email (or a stale session that still shows an implicit account id).
      const useEmail = kind === "email" || (kind == null && isImplicit(accountId));
      if (useEmail) {
        await fastAuthEnsure();
        for (const call of calls) await fastAuthSend(call);
        return;
      }
      if (kind === "evm") throw new Error("EVM wallets can register and withdraw. Hosting an event needs a NEAR account: sign out and sign in with Google or a NEAR wallet.");

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
    const key = `near-events:staff:${accountId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null") as { token: string; until: number } | null;
      if (saved && saved.until > Date.now()) return saved.token;
    } catch {}

    let proof: object;
    if (kind === "email" || (kind == null && isImplicit(accountId))) {
      proof = { mpc: await fastAuthProve() };
    } else if (kind === "wallet") {
      const c = connector.current;
      if (!c) throw new Error("Wallet is still loading. Wait a second and try again.");
      const wallet = await c.wallet();
      const nonce = new Uint8Array(32);
      crypto.getRandomValues(nonce);
      new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()));
      const signed = await wallet.signMessage({ message: STAFF_MESSAGE, recipient: EVENTS_CONTRACT, nonce });
      if (!signed) throw new Error("The wallet did not sign the message.");
      proof = {
        wallet: {
          accountId: signed.accountId,
          publicKey: signed.publicKey,
          signature: signed.signature,
          nonce: btoa(String.fromCharCode(...nonce)),
        },
      };
    } else {
      throw new Error("Door check-in needs a NEAR wallet or a Google/email account.");
    }
    const res = await fetch("/api/checkin/session", { method: "POST", body: JSON.stringify(proof) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not sign in");
    if (json.accountId !== accountId) throw new Error(`The wallet signed as ${json.accountId}, not ${accountId}.`);
    try {
      sessionStorage.setItem(key, JSON.stringify({ token: json.token, until: Date.now() + 11 * 60 * 60 * 1000 }));
    } catch {}
    return json.token as string;
  }, [kind, accountId]);

  return (
    <WalletContext.Provider
      value={{
        accountId,
        kind,
        ready,
        signIn,
        signInWithEmail,
        signInWithEvm,
        signOut,
        send,
        staffToken,
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
