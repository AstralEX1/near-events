"use client";

// Pay with any token, step 1 of 2: the guest sends it (one button from an EVM or NEAR wallet,
// or by hand) to a 1Click deposit address; 1Click delivers NEAR USDC to the guest's own NEAR
// Intents account, where step 2, the page's main button, registers. If the swap fails, 1Click
// refunds on the origin chain; if registering fails, the USDC stays in the guest's account.
// The quote's 1Click signature is checked before the address is shown (oneClickQuote).
import { useEffect, useMemo, useState } from "react";
import { NETWORK } from "@/lib/config";
import type { OneClickToken } from "@/lib/oneclick";
import {
  EVM_CHAIN_IDS, evmDepositTx, nep141Contract, oneClickQuote, oneClickTokens, payDepositAddress, submitDeposit,
  USDC_ASSET, waitForSwap, type Quote, type SwapStatus,
} from "@/lib/oneclickClient";
import { sendFromEvm } from "@/lib/intents";
import { formatUsdc } from "@/lib/near";
import type { Call } from "@/lib/wallet";

// Testnet's Tidepool only previews quotes; real deposits run on mainnet.
const LIVE = NETWORK === "mainnet";

const STATUS_TEXT: Record<SwapStatus, string> = {
  PENDING_DEPOSIT: "Waiting for your transfer…",
  KNOWN_DEPOSIT_TX: "Transfer seen. Swapping to USDC…",
  PROCESSING: "Swapping to USDC…",
  SUCCESS: "USDC arrived in your NEAR Intents account.",
  INCOMPLETE_DEPOSIT: "Less than the quoted amount arrived. 1Click refunds it to your wallet.",
  REFUNDED: "Refunded to your wallet.",
  FAILED: "The swap failed. 1Click refunds it to your wallet.",
};

export function PayWithToken({ accountId, kind, send, amount, paymentKey, onFunded }: {
  accountId: string;
  kind: string | null;
  send: (calls: Call[]) => Promise<void>;
  /** NEAR USDC (6 decimals) the guest's NEAR Intents account still needs. */
  amount: bigint;
  /** sessionStorage key, so a reload picks up a payment in flight. */
  paymentKey: string;
  onFunded: () => void;
}) {
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState("");
  const [refundTo, setRefundTo] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sent, setSent] = useState(false);
  const [status, setStatus] = useState<SwapStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(0);

  // A wallet pays tokens on its own chains with one button, so those come first.
  const ownChain = (t: OneClickToken) => (kind === "evm" ? !!EVM_CHAIN_IDS[t.blockchain] : t.blockchain === "near" && !!nep141Contract(t.assetId));

  useEffect(() => {
    let active = true;
    oneClickTokens().then((list) => {
      if (!active) return;
      const sorted = list.filter((t) => t.assetId !== USDC_ASSET)
        .sort((a, b) => Number(ownChain(b)) - Number(ownChain(a)) || a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
      setTokens(sorted);
      const preferred = kind === "evm" ? ["USDC", "base"] : ["wNEAR", "near"];
      setAssetId((current) => current || sorted.find((t) => t.symbol === preferred[0] && t.blockchain === preferred[1])?.assetId || sorted[0]?.assetId || "");
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(paymentKey) ?? "null") as { quote: Quote; assetId: string; sent?: boolean } | null;
      if (saved?.quote?.depositAddress) {
        setAssetId(saved.assetId);
        setQuote(saved.quote);
        setSent(!!saved.sent);
      }
    } catch { /* The payment can still be started again. */ }
  }, [paymentKey]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const evmChain = kind === "evm" ? EVM_CHAIN_IDS[token?.blockchain ?? ""] : undefined;
  const fromWallet = kind !== "evm" && token?.blockchain === "near" && !!nep141Contract(assetId);
  // Paying from the signed-in wallet: its own address takes any refund.
  const ownRefund = !!evmChain || fromWallet;

  useEffect(() => {
    if (!quote?.depositAddress) return;
    const controller = new AbortController();
    waitForSwap(quote.depositAddress, setStatus, { signal: controller.signal, memo: quote.depositMemo })
      .then(() => {
        try { sessionStorage.removeItem(paymentKey); } catch { /* Optional. */ }
        onFunded();
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.depositAddress, quote?.depositMemo, tracking]);

  const remember = (next: Quote, wasSent: boolean) => {
    try { sessionStorage.setItem(paymentKey, JSON.stringify({ quote: next, assetId, sent: wasSent })); } catch { /* Optional. */ }
  };

  const startOver = () => {
    setQuote(null);
    setStatus(null);
    setSent(false);
    setError(null);
    try { sessionStorage.removeItem(paymentKey); } catch { /* Optional. */ }
  };

  const getQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      if (LIVE && !ownRefund && !refundTo.trim()) throw new Error(`Enter your ${token?.blockchain} address, so a failed swap can be refunded there.`);
      const next = await oneClickQuote({
        dry: !LIVE, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
        originAsset: assetId, destinationAsset: USDC_ASSET, amount: amount.toString(),
        depositType: "ORIGIN_CHAIN", recipient: accountId, recipientType: "INTENTS",
        refundTo: ownRefund ? accountId : refundTo.trim() || accountId, refundType: "ORIGIN_CHAIN",
      });
      setStatus(null);
      setSent(false);
      setQuote(next);
      if (next.depositAddress) remember(next, false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendFromWallet = async () => {
    if (!quote?.depositAddress || !token) return;
    setBusy(true);
    setError(null);
    try {
      if (evmChain) {
        const hash = await sendFromEvm(evmChain, evmDepositTx(accountId, token, quote.depositAddress, quote.amountIn));
        submitDeposit(quote.depositAddress, hash);
      } else {
        await send(payDepositAddress(nep141Contract(assetId)!, quote.depositAddress, quote.amountIn));
      }
      setSent(true);
      remember(quote, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = status === "REFUNDED" || status === "FAILED" || status === "INCOMPLETE_DEPOSIT";

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">Pay with Any Token</h2>
      {!quote?.depositAddress && (
        <>
          <label className="block space-y-1.5">
            <span className="label">You pay with</span>
            <select className="input" value={assetId} disabled={busy} onChange={(e) => { setAssetId(e.target.value); setQuote(null); }}>
              {tokens.map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {t.blockchain}</option>)}
            </select>
          </label>
          {LIVE && !ownRefund && (
            <label className="block space-y-1.5">
              <span className="label">Your {token?.blockchain} address for refunds</span>
              <input className="input font-mono text-sm" value={refundTo} onChange={(e) => setRefundTo(e.target.value)} placeholder="Address" />
            </label>
          )}
          <button className="btn btn-primary w-full" disabled={busy || !assetId} onClick={getQuote}>
            {busy ? "Getting a price…" : `Get ${formatUsdc(amount.toString())} USDC with ${token?.symbol ?? "this token"}`}
          </button>
        </>
      )}
      {quote && (
        <div className="rounded-xl bg-bg p-4 space-y-2 text-sm">
          <div className="flex justify-between gap-3"><span className="text-muted">You send</span><b className="text-right">{quote.amountInFormatted} {token?.symbol} on {token?.blockchain}</b></div>
          {quote.amountInUsd && <div className="flex justify-between"><span className="text-muted">≈ USD</span><span>${Number(quote.amountInUsd).toFixed(2)}</span></div>}
          <div className="flex justify-between"><span className="text-muted">Your NEAR Intents account gets</span><span>{quote.amountOutFormatted} USDC</span></div>
          {quote.timeEstimate && <div className="flex justify-between"><span className="text-muted">Arrives in</span><span>~{quote.timeEstimate} s after your transfer</span></div>}
          {quote.depositAddress && (
            <div className="pt-2 border-t border-border space-y-2">
              {ownRefund && !sent && !quote.depositMemo && (!status || status === "PENDING_DEPOSIT") ? (
                <button className="btn btn-primary w-full" disabled={busy} onClick={sendFromWallet}>
                  {busy ? "Confirm in your wallet…" : "Send from Wallet"}
                </button>
              ) : !sent && (
                <div className="space-y-1">
                  <div className="text-muted">Send exactly {quote.amountInFormatted} {token?.symbol} on {token?.blockchain} to:</div>
                  <div className="font-mono break-all text-text">{quote.depositAddress}</div>
                  {quote.depositMemo && <div className="text-muted">Memo (required): <span className="font-mono text-text">{quote.depositMemo}</span></div>}
                </div>
              )}
              <p className={failed ? "text-warn" : "text-muted"}>{status ? STATUS_TEXT[status] : sent ? STATUS_TEXT.PENDING_DEPOSIT : "Address checked: signed by NEAR Intents."}</p>
              <div className="flex flex-wrap gap-2">
                {(sent || status) && !failed && status !== "SUCCESS" && (
                  <button className="btn btn-ghost" onClick={() => { setError(null); setTracking((n) => n + 1); }}>Check Again</button>
                )}
                {(failed || (!sent && !status)) && <button className="btn btn-ghost" onClick={startOver}>{failed ? "Try Again" : "Change Token"}</button>}
              </div>
            </div>
          )}
          {!quote.depositAddress && <p className="text-muted">Preview only on this network.</p>}
        </div>
      )}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
    </div>
  );
}
