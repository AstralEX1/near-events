"use client";

import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { HAS_INTENTS } from "@/lib/config";

/** The ways in: Google/email (no crypto needed), a NEAR wallet, or an EVM wallet via NEAR Intents. */
export function SignInOptions({ onDone }: { onDone?: () => void }) {
  const { ready, signIn, signInWithEmail, signInWithEvm } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button className="btn btn-primary w-full" disabled={!ready || busy} onClick={run(signInWithEmail)}>
        {busy ? "Opening sign-in…" : "Continue with Google or email"}
      </button>
      <button
        className="btn btn-ghost w-full"
        disabled={!ready || busy}
        onClick={run(signIn)}
      >
        Connect a NEAR wallet
      </button>
      {/* EVM wallets sign in through NEAR Intents (Tidepool's verifier on testnet). */}
      {HAS_INTENTS && (
        <button className="btn btn-ghost w-full" disabled={!ready || busy} onClick={run(signInWithEvm)}>
          MetaMask, Rabby or another EVM wallet
        </button>
      )}
      {error && <p className="text-xs text-warn break-words">{error}</p>}
    </div>
  );
}

export function SignInMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button className="btn btn-primary !py-1.5" onClick={() => setOpen(!open)}>
        Sign in
      </button>
      {open && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-72 card p-4 shadow-xl z-20">
            <div className="font-semibold mb-1">Welcome to Near Me</div>
            <p className="text-xs text-muted mb-3">No wallet? Sign in with Google or email; we create your NEAR account.</p>
            <SignInOptions onDone={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
