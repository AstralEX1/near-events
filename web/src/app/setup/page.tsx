"use client";

// One-time mainnet setup: the owner's EVM wallet (as a NEAR account via
// "Ethereum Wallets") creates the named account that will hold the escrow.
// The new account's key was generated locally and lives only in
// ~/.near-credentials/mainnet; this page only needs its public half.
import { useEffect, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";

const ACCOUNT = "near-events.near";
const PUBLIC_KEY = "ed25519:8f1DJZA4vWy9SuNZdJwxMWd7MkLAjZ6HaCyhhXE5WyYu";
const FUNDING_NEAR = "4.5";
const RPC = "https://rpc.mainnet.near.org";

async function nearBalance(accountId: string): Promise<number | null> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: { request_type: "view_account", finality: "final", account_id: accountId },
    }),
  }).then((x) => x.json());
  return r.result ? Number(BigInt(r.result.amount) / 10n ** 20n) / 1e4 : null;
}

export default function Setup() {
  const connector = useRef<NearConnector | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [myBalance, setMyBalance] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (id: string | null) => {
    setTarget(await nearBalance(ACCOUNT));
    if (id) setMyBalance(await nearBalance(id));
  };

  useEffect(() => {
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({ network: "mainnet", footerBranding: null });
      connector.current = c;
      c.on("wallet:signIn", (t) => {
        const id = t.accounts[0]?.accountId ?? null;
        setMe(id);
        refresh(id);
      });
      await refresh(null);
    })();
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const wallet = await connector.current!.wallet();
      await wallet.signAndSendTransaction({
        receiverId: "near",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "create_account",
              args: { new_account_id: ACCOUNT, new_public_key: PUBLIC_KEY },
              gas: "100000000000000",
              deposit: (BigInt(Math.round(Number(FUNDING_NEAR) * 1000)) * 10n ** 21n).toString(),
            },
          },
        ],
      });
      await refresh(me);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <h1 className="text-3xl font-semibold tracking-tight">Mainnet setup</h1>
      <p className="text-muted">
        Creates <b className="text-text">{ACCOUNT}</b> on NEAR mainnet, paid from your wallet, to hold the Near Events escrow.
        Use <b className="text-text">Ethereum Wallets</b> to sign with MetaMask: your 0x address is your NEAR account.
      </p>
      <div className="card p-5 space-y-4">
        {target !== null ? (
          <p className="text-good font-medium">✓ {ACCOUNT} exists with {target} NEAR. Tell Claude to continue.</p>
        ) : !me ? (
          <button className="btn btn-primary w-full" onClick={() => connector.current?.connect()}>Connect wallet (mainnet)</button>
        ) : (
          <>
            <p className="text-sm">
              Connected: <b className="break-all">{me}</b>
              <br />
              Balance: <b>{myBalance ?? "account not found"} NEAR</b> (needs about {Number(FUNDING_NEAR) + 0.1})
            </p>
            <button className="btn btn-primary w-full" disabled={busy} onClick={create}>
              {busy ? "Confirm in your wallet…" : `Create ${ACCOUNT} with ${FUNDING_NEAR} NEAR`}
            </button>
          </>
        )}
        {error && <p className="text-sm text-warn break-words">{error}</p>}
      </div>
    </div>
  );
}
