"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { events, formatUsdc, isTicket, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT, LIVE_EVENT_SWAPS } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import type { OneClickToken } from "@/lib/oneclick";
import { nep141Contract, oneClickQuote, oneClickTokens, payDepositAddress, USDC_ASSET, waitForSwap, type Quote } from "@/lib/oneclickClient";


import { confirmRegistration, intentsUsdcBalance, registerFromIntents, withdrawIntentsCall } from "@/lib/intents";
import { embedReturnPath } from "@/lib/embed";
import { guestNamesApi } from "@/lib/guestNamesClient";

function requireDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter your name so the host can find you at the door.");
  if (new TextEncoder().encode(name).length > 80) throw new Error("Name is too long. Shorten it and try again.");
  return name;
}

export default function PayFromAnyChain() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { accountId, kind, signIn, send, staffToken } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tracking, setTracking] = useState(0);
  const [available, setAvailable] = useState<bigint | null>(null);
  const [walletSent, setWalletSent] = useState(false);
  const [registered, setRegistered] = useState(false);
  const live = LIVE_EVENT_SWAPS;
  const paymentKey = `near-me:payment:${id}:${accountId ?? ""}`;

  useEffect(() => {
    let active = true;
    if (!Number.isSafeInteger(id) || id < 0) { setEvent(null); return; }
    events.get(id).then((value) => { if (active) setEvent(value); })
      .catch(() => { if (active) setLoadError("Could not load this event. Reload to try again."); });
    oneClickTokens().then((list) => {
      if (!active) return;
      const sorted = list.filter((x) => x.assetId !== USDC_ASSET).sort((a, b) => a.symbol.localeCompare(b.symbol));
      setTokens(sorted);
      setAssetId((current) => current || sorted.find((x) => x.symbol === "ETH" && x.blockchain === "base")?.assetId || sorted[0]?.assetId || "");
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    setQuote(null);
    setStatus(null);
    setRegistered(false);
    setWalletSent(false);
    setAvailable(null);
    if (!accountId || !live) return;
    let active = true;
    try {
      const saved = sessionStorage.getItem(paymentKey);
      if (saved) {
        const payment = JSON.parse(saved) as { quote: Quote; assetId: string; sent?: boolean };
        setAssetId(payment.assetId);
        setQuote(payment.quote);
        setWalletSent(!!payment.sent);
      }
    } catch { /* The payment can still be followed on this page. */ }
    intentsUsdcBalance(accountId).then((balance) => { if (active) setAvailable(balance); }).catch(() => {});
    events.guestStatus(id, accountId).then((state) => {
      if (!active) return;
      setRegistered(!!state);
      const returnPath = state && embedReturnPath(new URLSearchParams(window.location.search).get("returnTo"), id);
      if (returnPath) router.replace(returnPath);
    }).catch(() => {});
    return () => { active = false; };
  }, [accountId, id, live, paymentKey, router]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  // A NEP-141 token on NEAR can be paid from the signed-in NEAR wallet in one confirmation.
  const fromWallet = !!accountId && kind !== "evm" && token?.blockchain === "near" && !!nep141Contract(assetId);

  useEffect(() => {
    if (!quote?.depositAddress || !accountId) return;
    const controller = new AbortController();
    waitForSwap(quote.depositAddress, setStatus, { signal: controller.signal, memo: quote.depositMemo })
      .then(() => intentsUsdcBalance(accountId))
      .then((balance) => { if (!controller.signal.aborted) setAvailable(balance); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [quote?.depositAddress, quote?.depositMemo, accountId, tracking]);

  if (loadError) return <p className="text-warn">{loadError}</p>;
  if (event === undefined) return <p className="text-muted">Loading…</p>;
  if (!event) return <p>Event not found.</p>;
  const canRegister = event.status === "Open" && event.guest_count < event.capacity && !registered;

  const finishRegistration = async () => {
    if (!accountId || !canRegister) return;
    setBusy(true);
    setError(null);
    try {
      const name = requireDisplayName(displayName);
      if (kind === "evm") {
        await registerFromIntents(accountId, event.id, event.deposit, name);
      } else {
        const msg = JSON.stringify({ action: "register", event_id: event.id, guest: accountId });
        await send([withdrawIntentsCall(EVENTS_CONTRACT, event.deposit, msg)]);
      }
      await confirmRegistration(event.id, accountId);
      // EVM guests: the server already saved the name with the signed registration.
      if (kind !== "evm") try {
        const token = await staffToken();
        await guestNamesApi.save(event.id, name, token);
      } catch {
        // Registration already landed on-chain; name is best-effort for the host list.
      }
      setRegistered(true);
      try { sessionStorage.removeItem(paymentKey); } catch { /* Optional. */ }
      const returnPath = embedReturnPath(new URLSearchParams(window.location.search).get("returnTo"), event.id);
      if (returnPath) router.replace(returnPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      intentsUsdcBalance(accountId).then(setAvailable).catch(() => {});
      setBusy(false);
    }
  };

  const getQuote = async () => {
    if (!accountId) return signIn();
    if (live && !canRegister) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    try {
      const body = {
        dry: !live,
        swapType: "EXACT_OUTPUT",
        slippageTolerance: 100,
        originAsset: assetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: USDC_ASSET,
        amount: event.deposit,
        refundTo: fromWallet ? accountId : refundTo.trim() || "0x0000000000000000000000000000000000000000",
        refundType: "ORIGIN_CHAIN",
        recipient: accountId,
        recipientType: "INTENTS",
      };
      const next = await oneClickQuote(body);
      setStatus(null);
      setWalletSent(false);
      setQuote(next);
      if (next.depositAddress) {
        try { sessionStorage.setItem(paymentKey, JSON.stringify({ quote: next, assetId })); } catch { /* Optional. */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href={`/e/${id}`} className="text-muted hover:text-text">← {event.metadata.title}</Link>
      <h1 className="gc-page-title">Save your place.</h1>
      <p className="text-muted">
        Send any supported token from any chain. NEAR Intents (1Click) swaps it to exactly{" "}
        <b className="text-text">{formatUsdc(event.deposit)} USDC</b> {isTicket(event) ? "for your ticket " : ""}and credits your NEAR Intents balance. Confirm registration once the USDC arrives.
      </p>
      {live && accountId && available !== null && (
        <div className="card p-4 space-y-2">
          <p>{formatUsdc(available)} USDC in NEAR Intents. <Link href="/me" className="underline">View or withdraw funds</Link></p>
          {registered && <p className="text-good">Your place is confirmed.</p>}
          {canRegister && available >= BigInt(event.deposit) && (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Your name</span>
                <input
                  className="input w-full"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Name for the guest list"
                  autoComplete="name"
                  maxLength={80}
                  disabled={busy}
                />
              </label>
              <button className="btn btn-primary" disabled={busy} onClick={finishRegistration}>Confirm registration</button>
            </>
          )}
          {!canRegister && !registered && <p>This event is no longer accepting registrations.</p>}
        </div>
      )}
      <div className="card p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="label">Pay with</span>
          <select className="input" value={assetId} disabled={!!quote?.depositAddress} onChange={(e) => setAssetId(e.target.value)}>
            {tokens.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol} on {t.blockchain}
              </option>
            ))}
          </select>
        </label>
        {live && !fromWallet && (
          <label className="block space-y-1.5">
            <span className="label">Your {token?.blockchain} address for refunds</span>
            <input className="input font-mono text-sm" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder="0x…" />
          </label>
        )}
        <button className="btn btn-primary w-full" disabled={busy || !assetId || !!quote?.depositAddress || (live && (!canRegister || (!!accountId && !fromWallet && !refundTo.trim())))} onClick={getQuote}>
          {!accountId ? "Sign in first" : busy ? "Getting quote…" : live ? "Get deposit address" : "Get quote"}
        </button>

        {quote && (
          <div className="rounded-xl bg-bg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">You send</span><b>{quote.amountInFormatted} {token?.symbol}</b></div>
            {quote.amountInUsd && <div className="flex justify-between"><span className="text-muted">≈ USD</span><span>${Number(quote.amountInUsd).toFixed(2)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Your Intents account receives</span><span>{quote.amountOutFormatted} USDC</span></div>
            {quote.timeEstimate && <div className="flex justify-between"><span className="text-muted">Time</span><span>~{quote.timeEstimate}s after deposit</span></div>}
            {quote.depositAddress && (
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-muted">Send exactly {quote.amountInFormatted} {token?.symbol} on {token?.blockchain} to:</div>
                <div className="font-mono break-all text-text">{quote.depositAddress}</div>
                {quote.depositMemo && <div className="text-muted">Memo: <span className="font-mono">{quote.depositMemo}</span></div>}
                {fromWallet && !walletSent && !quote.depositMemo && (!status || status === "PENDING_DEPOSIT") && (
                  <button
                    className="btn btn-accent w-full my-2"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await send(payDepositAddress(nep141Contract(assetId)!, quote.depositAddress!, quote.amountIn));
                        setWalletSent(true);
                        try { sessionStorage.setItem(paymentKey, JSON.stringify({ quote, assetId, sent: true })); } catch { /* Optional. */ }
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Send from my NEAR wallet
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => { setError(null); setTracking((n) => n + 1); }}>Check payment</button>
                <div className="text-muted">Status: <b className="text-text">{status ?? "waiting for your deposit"}</b></div>
                {status === "REFUNDED" && (
                  <button className="btn btn-ghost" onClick={() => {
                    setQuote(null);
                    setStatus(null);
                    try { sessionStorage.removeItem(paymentKey); } catch { /* Optional. */ }
                  }}>Get another quote</button>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-warn break-words">{error}</p>}
      </div>
    </div>
  );
}
