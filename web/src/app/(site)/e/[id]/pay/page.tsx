"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { events, formatUsdc, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT, NETWORK } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import type { OneClickToken } from "@/lib/oneclick";
import { nep141Contract, payDepositAddress } from "@/lib/oneclickClient";


interface Quote {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd?: string;
  amountOutFormatted: string;
  timeEstimate?: number;
  deadline?: string;
}

export default function PayFromAnyChain() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId, kind, signIn, send } = useWallet();
  const [event, setEvent] = useState<EventView | null>(null);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  // USDC on NEAR, taken from the 1Click token list rather than hard-coded.
  const [usdcAsset, setUsdcAsset] = useState("");
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const live = NETWORK === "mainnet";

  useEffect(() => {
    events.get(id).then(setEvent);
    fetch("/api/oneclick/tokens")
      .then((r) => r.json())
      .then((t: OneClickToken[] | { error: string }) => {
        if (!Array.isArray(t)) throw new Error(t.error);
        const usdcNear = t.find((x) => x.symbol === "USDC" && x.blockchain === "near");
        if (!usdcNear) throw new Error("USDC on NEAR is missing from the token list");
        setUsdcAsset(usdcNear.assetId);
        const sorted = t.filter((x) => x.assetId !== usdcNear.assetId).sort((a, b) => a.symbol.localeCompare(b.symbol));
        setTokens(sorted);
        setAssetId(sorted.find((x) => x.symbol === "ETH" && x.blockchain === "base")?.assetId ?? sorted[0]?.assetId ?? "");
      })
      .catch((e) => setError(`Could not load tokens from 1Click: ${e.message ?? e}`));
  }, [id]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  // A NEP-141 token on NEAR can be paid from the signed-in NEAR wallet in one confirmation.
  const fromWallet = !!accountId && kind !== "evm" && token?.blockchain === "near" && !!nep141Contract(assetId);

  // Poll swap status once a real deposit address exists.
  useEffect(() => {
    if (!quote?.depositAddress) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/oneclick/status?depositAddress=${quote.depositAddress}`).then((x) => x.json()).catch(() => null);
      if (r?.status) setStatus(r.status);
      if (r?.status === "SUCCESS" || r?.status === "REFUNDED" || r?.status === "FAILED") clearInterval(t);
    }, 5000);
    return () => clearInterval(t);
  }, [quote?.depositAddress]);

  if (!event) return <p className="text-muted">Loading…</p>;

  const getQuote = async () => {
    if (!accountId) return signIn();
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
        destinationAsset: usdcAsset,
        amount: event.deposit,
        refundTo: fromWallet ? accountId : refundTo || "0x0000000000000000000000000000000000000000",
        refundType: "ORIGIN_CHAIN",
        // 1Click calls ft_transfer_call on the escrow with this msg: the swap itself registers the guest.
        recipient: EVENTS_CONTRACT,
        recipientType: "DESTINATION_CHAIN",
        customRecipientMsg: JSON.stringify({ action: "register", event_id: event.id, guest: accountId }),
        deadline: new Date(Date.now() + 60 * 60_000).toISOString(),
        referral: "near-events",
      };
      const r = await fetch("/api/oneclick/quote", { method: "POST", body: JSON.stringify(body) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.message ?? json.error ?? `1Click error ${r.status}`);
      setQuote(json.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <Link href={`/e/${id}`} className="text-muted hover:text-text">← {event.metadata.title}</Link>
      <h1 className="text-3xl font-semibold tracking-tight">Pay from any chain</h1>
      <p className="text-muted">
        Send any supported token from any chain. NEAR Intents (1Click) swaps it to exactly{" "}
        <b className="text-text">{formatUsdc(event.deposit)} USDC</b> and delivers it to the event escrow, which registers{" "}
        {accountId ? <b className="text-text">{accountId}</b> : "you"} in the same step. Anything extra is refunded.
      </p>
      {!live && (
        <div className="card p-3 text-sm border-accent/40 bg-accent-soft/40">
          NEAR Intents runs on mainnet only, so on testnet this shows a live <b>price preview</b> (dry quote). On testnet,
          register with test USDC from the event page.
        </div>
      )}

      <div className="card p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="label">Pay with</span>
          <select className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
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
        <button className="btn btn-primary w-full" disabled={busy || !assetId || !usdcAsset || (live && !fromWallet && !refundTo)} onClick={getQuote}>
          {!accountId ? "Sign in first" : busy ? "Getting quote…" : live ? "Get deposit address" : "Preview price"}
        </button>

        {quote && (
          <div className="rounded-xl bg-bg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">You send</span><b>{quote.amountInFormatted} {token?.symbol}</b></div>
            {quote.amountInUsd && <div className="flex justify-between"><span className="text-muted">≈ USD</span><span>${Number(quote.amountInUsd).toFixed(2)}</span></div>}
            <div className="flex justify-between"><span className="text-muted">Escrow receives</span><span>{quote.amountOutFormatted} USDC</span></div>
            {quote.timeEstimate && <div className="flex justify-between"><span className="text-muted">Time</span><span>~{quote.timeEstimate}s after deposit</span></div>}
            {quote.depositAddress && (
              <div className="pt-2 border-t border-border space-y-1">
                <div className="text-muted">Send exactly {quote.amountInFormatted} {token?.symbol} on {token?.blockchain} to:</div>
                <div className="font-mono break-all text-text">{quote.depositAddress}</div>
                {quote.depositMemo && <div className="text-muted">Memo: <span className="font-mono">{quote.depositMemo}</span></div>}
                {fromWallet && (
                  <button
                    className="btn btn-accent w-full my-2"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await send(payDepositAddress(nep141Contract(assetId)!, quote.depositAddress!, quote.amountIn));
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
                <div className="text-muted">Status: <b className="text-text">{status ?? "waiting for your deposit"}</b></div>
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-warn break-words">{error}</p>}
      </div>
    </div>
  );
}
