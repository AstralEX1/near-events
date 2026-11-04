"use client";

import { useEffect, useMemo, useState } from "react";
import { EVENTS_CONTRACT } from "@/lib/config";
import { formatUsdc, toUnits } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { pushPayoutToIntents, transferFromIntents } from "@/lib/intents";
import { oneClickQuote, oneClickTokens, registerUsdcFor, USDC_ASSET, waitForSwap, type Quote } from "@/lib/oneclickClient";
import type { OneClickToken } from "@/lib/oneclick";

/**
 * Cash out a Near Events payout to any chain through NEAR Intents (1Click).
 * NEAR accounts: the escrow sends USDC straight to the 1Click deposit address
 * (one wallet confirmation). EVM wallets: the relayer moves the payout into the
 * wallet's Intents balance, then the wallet signs one transfer to 1Click.
 */
export function CashOut({
  accountId,
  kind,
  balance,
  amount,
  onDone,
  fromIntents = false,
}: {
  accountId: string;
  kind: string | null;
  balance: bigint;
  amount: string;
  onDone: () => Promise<void>;
  /** EVM only: the USDC already sits in the wallet's Intents balance. */
  fromIntents?: boolean;
}) {
  const { send } = useWallet();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evm = kind === "evm";

  useEffect(() => {
    if (!open || tokens.length) return;
    oneClickTokens()
      .then((t) => {
        const list = t.filter((x) => x.assetId !== USDC_ASSET).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain));
        setTokens(list);
        setAssetId(list.find((x) => x.symbol === "USDC" && x.blockchain === "base")?.assetId ?? list[0]?.assetId ?? "");
      })
      .catch((e) => setError(e.message));
  }, [open, tokens.length]);

  useEffect(() => {
    if (evm && !recipient) setRecipient(accountId);
  }, [evm, accountId, recipient]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const units = amount ? BigInt(toUnits(amount)) : balance;

  const step = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const getQuote = () =>
    step(async () => {
      setQuote(null);
      if (units <= 0n || units > balance) throw new Error("Pick an amount up to your balance.");
      if (!recipient.trim()) throw new Error(`Enter your ${token?.blockchain ?? ""} address.`);
      setQuote(
        await oneClickQuote({
          dry: false,
          swapType: "EXACT_INPUT",
          originAsset: USDC_ASSET,
          depositType: evm ? "INTENTS" : "ORIGIN_CHAIN",
          destinationAsset: assetId,
          amount: units.toString(),
          recipient: recipient.trim(),
          recipientType: "DESTINATION_CHAIN",
          // A failed swap lands back in the guest's own Intents balance.
          refundTo: accountId,
          refundType: "INTENTS",
        }),
      );
    });

  const confirm = () =>
    step(async () => {
      const addr = quote?.depositAddress;
      if (!quote || !addr) throw new Error("Get a fresh quote first.");
      if (evm) {
        if (!fromIntents) {
          setStage("Moving your payout into NEAR Intents…");
          await pushPayoutToIntents(accountId);
        }
        setStage("Sign in your wallet…");
        await transferFromIntents(accountId, addr, quote.amountIn);
      } else {
        setStage("Confirm in your wallet…");
        await send([
          registerUsdcFor(addr),
          {
            receiverId: EVENTS_CONTRACT,
            methodName: "withdraw",
            args: { amount: quote.amountIn, receiver_id: addr, to_intents: false },
            deposit: 1n,
            gas: 200_000_000_000_000n,
          },
        ]);
      }
      setStage("NEAR Intents is sending it…");
      await waitForSwap(addr, (s) => setStage(`NEAR Intents: ${s.toLowerCase().replaceAll("_", " ")}…`));
      setQuote(null);
      await onDone();
    });

  if (!open)
    return (
      <button className="btn btn-ghost w-full" onClick={() => setOpen(true)}>
        Cash out to any chain
      </button>
    );

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="text-sm font-medium">Cash out {formatUsdc(units)} USDC to any chain</div>
      <select className="input" value={assetId} onChange={(e) => (setAssetId(e.target.value), setQuote(null))}>
        {tokens.map((t) => (
          <option key={t.assetId} value={t.assetId}>
            {t.symbol} on {t.blockchain}
          </option>
        ))}
      </select>
      <input
        className="input font-mono text-sm"
        placeholder={`Your ${token?.blockchain ?? ""} address`}
        value={recipient}
        onChange={(e) => (setRecipient(e.target.value), setQuote(null))}
      />
      {!quote ? (
        <button className="btn btn-primary w-full" disabled={busy || !assetId} onClick={getQuote}>
          {busy ? "Getting quote…" : "Get quote"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg bg-bg p-3 text-sm flex justify-between">
            <span className="text-muted">You receive</span>
            <b>
              {quote.amountOutFormatted} {token?.symbol} on {token?.blockchain}
            </b>
          </div>
          <button className="btn btn-primary w-full" disabled={busy} onClick={confirm}>
            {busy ? stage ?? "Working…" : "Confirm cash-out"}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      <p className="text-xs text-muted">Through NEAR Intents (1Click). If the swap fails, the USDC returns to your NEAR Intents balance.</p>
    </div>
  );
}
