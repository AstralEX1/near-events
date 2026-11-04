"use client";

import { useEffect, useMemo, useState } from "react";
import { EVENTS_CONTRACT } from "@/lib/config";
import { formatUsdc, toUnits } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { pushPayoutToIntents, transferFromIntents } from "@/lib/intents";
import { oneClickQuote, oneClickTokens, registerUsdcFor, USDC_ASSET, waitForSwap, type Quote } from "@/lib/oneclickClient";
import type { OneClickToken } from "@/lib/oneclick";

/** Pseudo-asset: keep USDC inside NEAR Intents (near.com and other Intents wallets). */
const INTENTS_ACCOUNT = "intents";

/**
 * The one way money leaves Near Events: payouts and refunds go out through
 * NEAR Intents, to any chain and any wallet, or to any NEAR Intents account.
 * NEAR accounts: the escrow sends straight to the destination (one wallet
 * confirmation). EVM wallets: the relayer moves the payout into the wallet's
 * Intents balance, then the wallet signs one transfer.
 */
export function CashOut({
  accountId,
  kind,
  balance,
  onDone,
  fromIntents = false,
  startOpen = false,
}: {
  accountId: string;
  kind: string | null;
  balance: bigint;
  onDone: () => Promise<void> | void;
  /** EVM only: the USDC already sits in the wallet's Intents balance. */
  fromIntents?: boolean;
  startOpen?: boolean;
}) {
  const { send } = useWallet();
  const [open, setOpen] = useState(startOpen);
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [assetId, setAssetId] = useState(INTENTS_ACCOUNT);
  const [recipient, setRecipient] = useState(accountId);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const evm = kind === "evm";

  useEffect(() => {
    if (!open || tokens.length) return;
    oneClickTokens()
      .then((t) => setTokens([...t].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain))))
      .catch((e) => setError(e.message));
  }, [open, tokens.length]);

  const token = useMemo(() => tokens.find((t) => t.assetId === assetId), [tokens, assetId]);
  const toIntents = assetId === INTENTS_ACCOUNT;
  const units = amount ? BigInt(toUnits(amount)) : balance;
  const where = toIntents ? "NEAR Intents account" : `${token?.blockchain ?? ""} address`;

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

  const check = () => {
    if (units <= 0n || units > balance) throw new Error("Pick an amount up to your balance.");
    if (!recipient.trim()) throw new Error(`Enter the ${where}.`);
  };

  const getQuote = () =>
    step(async () => {
      setQuote(null);
      check();
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

  const finish = async (text: string) => {
    setQuote(null);
    setDone(text);
    await onDone();
  };

  // Straight into a NEAR Intents account: no swap, no 1Click.
  const sendToIntents = () =>
    step(async () => {
      check();
      const to = recipient.trim();
      if (evm) {
        if (!fromIntents) {
          setStage("Moving your payout into NEAR Intents…");
          await pushPayoutToIntents(accountId);
        }
        if (to !== accountId) {
          setStage("Sign in your wallet…");
          await transferFromIntents(accountId, to, units.toString());
        }
      } else {
        setStage("Confirm in your wallet…");
        await send([
          {
            receiverId: EVENTS_CONTRACT,
            methodName: "withdraw",
            args: { amount: units.toString(), receiver_id: to, to_intents: true },
            deposit: 1n,
            gas: 200_000_000_000_000n,
          },
        ]);
      }
      await finish(`Sent ${formatUsdc(units)} USDC to ${to} in NEAR Intents.`);
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
      await finish(`Sent ${quote.amountOutFormatted} ${token?.symbol} on ${token?.blockchain} to ${recipient.trim()}.`);
    });

  if (!open)
    return (
      <button className="btn btn-primary w-full" onClick={() => setOpen(true)}>
        Withdraw {formatUsdc(balance)} USDC
      </button>
    );

  return (
    <div className="rounded-xl border border-border p-4 space-y-3 text-left">
      <div className="text-sm font-medium">Withdraw to any chain or wallet</div>
      <input
        className="input"
        type="number"
        min="0"
        step="0.01"
        placeholder={`Amount (all: ${formatUsdc(balance)} USDC)`}
        value={amount}
        onChange={(e) => (setAmount(e.target.value), setQuote(null))}
      />
      <select
        className="input"
        value={assetId}
        onChange={(e) => {
          setAssetId(e.target.value);
          setQuote(null);
          setRecipient(e.target.value === INTENTS_ACCOUNT || (evm && e.target.value.includes("0x")) ? accountId : "");
        }}
      >
        <option value={INTENTS_ACCOUNT}>USDC in NEAR Intents (near.com and other Intents wallets)</option>
        {tokens.map((t) => (
          <option key={t.assetId} value={t.assetId}>
            {t.symbol} on {t.blockchain}
          </option>
        ))}
      </select>
      <input
        className="input font-mono text-sm"
        placeholder={`Your ${where}`}
        value={recipient}
        onChange={(e) => (setRecipient(e.target.value), setQuote(null))}
      />
      {toIntents ? (
        <button className="btn btn-primary w-full" disabled={busy} onClick={sendToIntents}>
          {busy ? stage ?? "Working…" : `Withdraw ${formatUsdc(units)} USDC`}
        </button>
      ) : !quote ? (
        <button className="btn btn-primary w-full" disabled={busy || !token} onClick={getQuote}>
          {busy ? "Getting quote…" : "Get quote"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg bg-bg p-3 text-sm flex justify-between gap-2">
            <span className="text-muted">You receive</span>
            <b className="text-right">
              {quote.amountOutFormatted} {token?.symbol} on {token?.blockchain}
            </b>
          </div>
          <button className="btn btn-primary w-full" disabled={busy} onClick={confirm}>
            {busy ? stage ?? "Working…" : "Confirm withdrawal"}
          </button>
        </div>
      )}
      {done && <p className="text-sm text-good">✓ {done}</p>}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      <p className="text-xs text-muted">Through NEAR Intents. If a swap fails, the USDC returns to your NEAR Intents balance.</p>
    </div>
  );
}
