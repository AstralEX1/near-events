"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, toUnits, usdc, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_INTENTS, NETWORK } from "@/lib/config";
import { CashOut } from "@/components/CashOut";
import { useWallet } from "@/lib/wallet";
import { intentsUsdcBalance, pushPayoutToIntents } from "@/lib/intents";
import { Avatar, Cover, shortAccount } from "@/components/ui";

export default function Me() {
  const { accountId, kind, signIn, send } = useWallet();
  const [balance, setBalance] = useState<bigint>(0n);
  const [wallet, setWallet] = useState<bigint>(0n);
  const [inIntents, setInIntents] = useState<bigint | null>(null);
  const [mine, setMine] = useState<EventView[]>([]);
  const [amount, setAmount] = useState("");
  const [receiver, setReceiver] = useState("");
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
    setMine(all.filter((e) => ids.includes(e.id) || e.host === accountId || e.cohosts.includes(accountId)));
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
          args: { amount: amount ? toUnits(amount) : null, receiver_id: receiver.trim() || null, to_intents: toIntents },
          deposit: 1n,
          gas: 200_000_000_000_000n,
        },
      ]);
      setAmount("");
      setReceiver("");
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
        {balance > 0n && HAS_INTENTS && (
          <div className="space-y-3">
            <input className="input" type="number" min="0" step="0.01" placeholder={`Amount (all: ${formatUsdc(balance)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn btn-primary w-full" disabled={busy} onClick={() => withdraw(true)}>
              Withdraw to my NEAR Intents balance
            </button>
            <CashOut accountId={accountId} kind={kind} balance={balance} amount={amount} onDone={load} />
            {kind !== "evm" && (
              <details className="text-sm">
                <summary className="text-muted cursor-pointer">Send without NEAR Intents</summary>
                <div className="space-y-2 pt-2">
                  <input
                    className="input"
                    placeholder="NEAR account (empty = my wallet)"
                    value={receiver}
                    onChange={(e) => setReceiver(e.target.value)}
                  />
                  <button className="btn btn-ghost w-full" disabled={busy} onClick={() => withdraw(false)}>
                    {receiver.trim() ? `Send to ${shortAccount(receiver.trim())}` : "Withdraw to my NEAR wallet"}
                  </button>
                </div>
              </details>
            )}
          </div>
        )}
        {balance > 0n && !HAS_INTENTS && (
          <div className="space-y-3">
            <input className="input" type="number" min="0" step="0.01" placeholder={`Amount (all: ${formatUsdc(balance)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
            {kind !== "evm" && (
              <input
                className="input"
                placeholder="Send to another NEAR account (optional, e.g. a friend or an exchange)"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
              />
            )}
            {kind !== "evm" && (
              <button className="btn btn-primary w-full" disabled={busy} onClick={() => withdraw(false)}>
                {receiver.trim() ? `Send to ${shortAccount(receiver.trim())}` : "Withdraw to my NEAR wallet"}
              </button>
            )}
            <p className="text-xs text-muted">NEAR Intents has no testnet. On mainnet payouts go through NEAR Intents to any chain.</p>
          </div>
        )}
        {HAS_INTENTS && balance === 0n && inIntents !== null && inIntents > 0n && kind === "evm" && (
          <CashOut accountId={accountId} kind={kind} balance={inIntents} amount={amount} onDone={load} fromIntents />
        )}
        {HAS_INTENTS && inIntents !== null && inIntents > 0n && kind !== "evm" && (
          <p className="text-xs text-muted">
            You have {formatUsdc(inIntents)} USDC in NEAR Intents. Swap or send it to any chain at{" "}
            <a className="text-accent" href="https://near-intents.org" target="_blank" rel="noreferrer">near-intents.org</a>.
          </p>
        )}
        {error && <p className="text-sm text-warn break-words">{error}</p>}
      </div>

      {(
        [
          ["Going", mine.filter((e) => e.host !== accountId && !e.cohosts.includes(accountId)), "Nothing yet."],
          ["Hosting", mine.filter((e) => e.host === accountId || e.cohosts.includes(accountId)), "You aren’t hosting anything."],
        ] as [string, EventView[], string][]
      ).map(([title, list, empty]) => (
        <div key={title}>
          <h2 className="text-xl font-semibold mb-3">{title}</h2>
          {list.length === 0 && (
            <p className="text-muted">
              {empty} <Link href={title === "Going" ? "/events" : "/create"} className="text-accent">{title === "Going" ? "Find an event" : "Host one"}</Link>
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((e) => (
              <Link key={e.id} href={`/e/${e.id}`} className="flex gap-3 items-center rounded-xl p-2 -m-2 hover:bg-border/40">
                <Cover event={e} className="w-16 h-16 rounded-lg shrink-0 [&>span]:hidden" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{e.metadata.title}</div>
                  <div className="text-sm text-muted">
                    {new Date(e.metadata.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {e.status !== "Open" && ` · ${e.status === "Finalized" ? "paid out" : "cancelled"}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
