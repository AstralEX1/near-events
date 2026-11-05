"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView } from "@/lib/near";
import { HAS_INTENTS } from "@/lib/config";
import { CashOut } from "@/components/CashOut";
import { useWallet } from "@/lib/wallet";
import { intentsUsdcBalance } from "@/lib/intents";
import { Avatar, Cover, shortAccount } from "@/components/ui";

export default function Me() {
  const { accountId, kind, signIn } = useWallet();
  const [balance, setBalance] = useState<bigint>(0n);
  const [wallet, setWallet] = useState<bigint>(0n);
  const [inIntents, setInIntents] = useState<bigint | null>(null);
  const [mine, setMine] = useState<EventView[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    const [b, w, ids, all] = await Promise.all([
      events.balance(accountId),
      usdc.balance(accountId).catch(() => "0"),
      events.guestEvents(accountId),
      events.list(),
    ]);
    setBalance(BigInt(b));
    if (HAS_INTENTS) intentsUsdcBalance(accountId).then(setInIntents).catch(() => {});
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
          <div className="label">Near Me balance</div>
          <div className="text-4xl font-semibold mt-1">{formatUsdc(balance)} <span className="text-lg text-muted">USDC</span></div>
          <p className="text-sm text-muted mt-1">Payouts and refunds land here. Withdraw them through NEAR Intents to any chain or wallet.</p>
        </div>
        {balance > 0n && <CashOut accountId={accountId} kind={kind} balance={balance} onDone={load} />}
        {kind === "evm" && balance === 0n && inIntents !== null && inIntents > 0n && (
          <CashOut accountId={accountId} kind={kind} balance={inIntents} onDone={load} fromIntents />
        )}
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
