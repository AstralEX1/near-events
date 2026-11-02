"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, toUnits, usdc, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT, NETWORK } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { intentsUsdcBalance, pushPayoutToIntents } from "@/lib/intents";
import { Avatar, Cover, StatusPill, shortAccount } from "@/components/ui";

export default function Me() {
  const { accountId, kind, signIn, send } = useWallet();
  const [balance, setBalance] = useState<bigint>(0n);
  const [wallet, setWallet] = useState<bigint>(0n);
  const [inIntents, setInIntents] = useState<bigint | null>(null);
  const [mine, setMine] = useState<EventView[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [b, w, ids, all] = await Promise.all([
      events.balance(accountId),
      usdc.balance(accountId).catch(() => "0"),
      events.guestEvents(accountId),
      events.list(),
    ]);
    setBalance(BigInt(b));
    if (NETWORK === "mainnet") intentsUsdcBalance(accountId).then(setInIntents).catch(() => {});
    setWallet(BigInt(w));
    setMine(all.filter((e) => ids.includes(e.id) || e.host === accountId));
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!accountId) {
    return (
      <div className="text-center py-20">
        <button className="btn btn-primary" onClick={signIn}>Connect a wallet to see your balance</button>
      </div>
    );
  }

  const sendToIntents = async () => {
    setBusy(true);
    setError(null);
    try {
      await pushPayoutToIntents(accountId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (toIntents: boolean) => {
    if (toIntents && kind !== "wallet") return sendToIntents();
    setBusy(true);
    setError(null);
    try {
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "withdraw",
          args: { amount: amount ? toUnits(amount) : null, receiver_id: null, to_intents: toIntents },
          deposit: 1n,
          gas: 200_000_000_000_000n,
        },
      ]);
      setAmount("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar account={accountId} size={56} />
        <div>
          <h1 className="text-2xl font-semibold break-all">{shortAccount(accountId)}</h1>
          <p className="text-sm text-muted">
            {kind !== "evm" && <>USDC in your NEAR wallet: {formatUsdc(wallet)}</>}
            {inIntents !== null && <> · in NEAR Intents: {formatUsdc(inIntents)}</>}
          </p>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <div className="label">Near Events balance</div>
          <div className="text-4xl font-semibold mt-1">{formatUsdc(balance)} <span className="text-lg text-muted">USDC</span></div>
          <p className="text-sm text-muted mt-1">Payouts and refunds land here. Reuse them for your next event or withdraw.</p>
        </div>
        {balance > 0n && (
          <div className="space-y-3">
            <input className="input" type="number" min="0" step="0.01" placeholder={`Amount (all: ${formatUsdc(balance)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="grid sm:grid-cols-2 gap-2">
              {kind !== "evm" && (
                <button className="btn btn-primary" disabled={busy} onClick={() => withdraw(false)}>Withdraw to my NEAR wallet</button>
              )}
              <button
                className="btn btn-ghost"
                disabled={busy || NETWORK !== "mainnet"}
                title={NETWORK !== "mainnet" ? "NEAR Intents runs on mainnet only" : undefined}
                onClick={() => withdraw(true)}
              >
                Send to NEAR Intents → any chain
              </button>
            </div>
            {NETWORK === "mainnet" && (
              <p className="text-xs text-muted">
                From NEAR Intents you can swap or withdraw to any chain at{" "}
                <a className="text-accent" href="https://near-intents.org" target="_blank" rel="noreferrer">near-intents.org</a>.
              </p>
            )}
            {NETWORK !== "mainnet" && (
              <p className="text-xs text-muted">NEAR Intents has no testnet, so cash-out to other chains is enabled on mainnet.</p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-warn break-words">{error}</p>}
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-3">Your events</h2>
        {mine.length === 0 && <p className="text-muted">Nothing yet. <Link href="/" className="text-accent">Find an event</Link></p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {mine.map((e) => (
            <Link key={e.id} href={`/e/${e.id}`} className="card p-3 flex gap-3 items-center hover:border-accent/50">
              <Cover event={e} className="w-16 h-16 rounded-lg shrink-0 [&>span]:hidden" />
              <div className="min-w-0">
                <div className="font-medium truncate">{e.metadata.title}</div>
                <div className="text-sm text-muted">
                  {new Date(e.metadata.starts_at).toLocaleDateString()} · {e.host === accountId ? "Hosting" : "Guest"}
                </div>
                <StatusPill status={e.status} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
