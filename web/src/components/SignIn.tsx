"use client";
/* eslint-disable @next/next/no-img-element -- wallet icons are the extensions' own data URIs and small brand marks */

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useWallet } from "@/lib/wallet";
import { FASTAUTH_CLIENT_ID, HAS_INTENTS } from "@/lib/config";
import { evmWallets, type EvmWallet } from "@/lib/intents";

const ICON = "h-10 w-10 shrink-0 rounded-full";
const EthMark = () => <span className={`${ICON} grid place-items-center bg-[var(--accent-soft)] p-2.5`}><img src="/event-themes/marks/ethereum.svg" alt="" className="h-full" /></span>;

/** A wallet tile like near.com's sign-in: round icon on top, name below. */
function Tile({ icon, name, ...props }: { icon: ReactNode; name: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className="gc-mode-card text-left disabled:cursor-not-allowed disabled:opacity-50" {...props}>
      {icon}
      <span className="mt-5 block truncate font-semibold">{name}</span>
    </button>
  );
}

/** The ways in, near.com-style: pick the chain first (NEAR or EVM through NEAR Intents), then the wallet. Google/email stays on top when NEAR Auth is set up. */
export function SignInOptions({ onDone }: { onDone?: () => void }) {
  const { ready, signIn, signInWithEmail, signInWithEvm, signInWithDemo } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"chain" | "evm">("chain");
  // Read after mount: extensions announce themselves (EIP-6963) only in the browser.
  const [evm, setEvm] = useState<EvmWallet[]>([]);
  useEffect(() => setEvm(evmWallets()), []);
  const off = !ready || busy !== null;

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
    <div className="space-y-3">
      {step === "chain" ? (
        <>
          {FASTAUTH_CLIENT_ID && (
            <button className="btn btn-primary w-full" disabled={off} onClick={run(signInWithEmail, "email")}>
              {busy === "email" ? "Opening sign-in…" : "Continue with Google or email"}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Tile
              name={busy === "wallet" ? "Opening…" : "NEAR Wallets"}
              disabled={off}
              onClick={run(signIn, "wallet")}
              icon={<span className={`${ICON} grid place-items-center bg-black p-2.5`}><img src="/event-themes/marks/near.svg" alt="" className="h-full" /></span>}
            />
            {/* EVM wallets sign in through NEAR Intents (intents.near; Tidepool's verifier on testnet). */}
            {HAS_INTENTS && (
              <Tile
                name="EVM Wallets"
                disabled={off}
                onClick={() => { setEvm(evmWallets()); setError(null); setStep("evm"); }}
                icon={evm.some((w) => w.icon) ? (
                  <span className="flex">
                    {evm.filter((w) => w.icon).slice(0, 3).map((w) => (
                      <img key={w.id} src={w.icon} alt="" className={`${ICON} -ml-3 bg-[var(--surface)] ring-2 ring-[var(--surface)] first:ml-0`} />
                    ))}
                  </span>
                ) : <EthMark />}
              />
            )}
          </div>
          {/* Demo mode: made-up events and money in this browser, no server and no chain. */}
          <button className="btn btn-ghost w-full" disabled={off} onClick={run(signInWithDemo, "demo")}>
            {busy === "demo" ? "Setting up…" : "Try with a demo account"}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <button type="button" autoFocus aria-label="Back" className="-ml-2 grid h-9 w-9 place-items-center rounded-full hover:bg-[var(--accent-soft)]" onClick={() => setStep("chain")}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
            </button>
            <span className="font-semibold">Choose your EVM wallet</span>
          </div>
          {evm.length ? (
            <div className="grid grid-cols-2 gap-2">
              {evm.map((w) => (
                <Tile
                  key={w.id}
                  name={busy === w.id ? "Connecting…" : w.name}
                  disabled={off}
                  onClick={run(() => signInWithEvm(w.id), w.id)}
                  icon={w.icon ? <img src={w.icon} alt="" className={ICON} /> : <EthMark />}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">
              No EVM wallet in this browser. Get{" "}
              <a className="underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask</a> or{" "}
              <a className="underline" href="https://rabby.io/" target="_blank" rel="noreferrer">Rabby</a>, then reload the page.
            </p>
          )}
        </>
      )}
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
            className="fixed inset-x-3 top-[4.25rem] z-50 max-h-[calc(100dvh-5rem)] overflow-y-auto whitespace-normal rounded-2xl card p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-h-[min(70vh,32rem)]"
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
