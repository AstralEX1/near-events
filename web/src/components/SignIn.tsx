"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { FASTAUTH_CLIENT_ID, HAS_INTENTS } from "@/lib/config";

/** The ways in: Google/email (no crypto needed), a NEAR wallet, or an EVM wallet via NEAR Intents. */
export function SignInOptions({ onDone }: { onDone?: () => void }) {
  const { ready, signIn, signInWithEmail, signInWithEvm, signInWithDemo } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<void>, label: string) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {FASTAUTH_CLIENT_ID && (
        <button className="btn btn-primary w-full" disabled={!ready || busy !== null} onClick={run(signInWithEmail, "email")}>
          {busy === "email" ? "Opening sign-in…" : "Continue with Google or email"}
        </button>
      )}
      <button
        className={`btn ${FASTAUTH_CLIENT_ID ? "btn-ghost" : "btn-primary"} w-full`}
        disabled={!ready || busy !== null}
        onClick={run(signIn, "wallet")}
      >
        Connect a NEAR wallet
      </button>
      {/* EVM wallets sign in through NEAR Intents (intents.near; Tidepool's verifier on testnet). */}
      {HAS_INTENTS && (
        <button className="btn btn-ghost w-full" disabled={!ready || busy !== null} onClick={run(signInWithEvm, "evm")}>
          MetaMask, Rabby or another EVM wallet
        </button>
      )}
      {/* Demo mode: made-up events and money in this browser, no server and no chain. */}
      <button className="btn btn-ghost w-full" disabled={!ready || busy !== null} onClick={run(signInWithDemo, "demo")}>
        {busy === "demo" ? "Setting up…" : "Try with a demo account"}
      </button>
      {error && <p className="text-xs text-warn break-words">{error}</p>}
    </div>
  );
}

export function SignInMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-primary !py-1.5"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="near-me-signin-options"
        onClick={() => setOpen((value) => !value)}
      >
        Sign In
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close sign-in options"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-black/25 sm:bg-black/0"
            onClick={close}
          />
          <div
            ref={panelRef}
            id="near-me-signin-options"
            role="dialog"
            aria-modal="true"
            aria-labelledby="near-me-signin-title"
            tabIndex={-1}
            className="fixed inset-x-3 top-[4.25rem] z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto whitespace-normal rounded-2xl card p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80 sm:max-h-[min(70vh,32rem)]"
          >
            <div id="near-me-signin-title" className="font-semibold mb-1">Welcome to Nearvent</div>
            {FASTAUTH_CLIENT_ID && <p className="text-xs text-muted mb-3">No wallet? Sign in with Google or email; we create your NEAR account.</p>}
            <SignInOptions onDone={close} />
          </div>
        </>
      )}
    </div>
  );
}
