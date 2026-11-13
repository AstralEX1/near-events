"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView } from "@/lib/near";
import { hostAccounts, isDaoAccount } from "@/lib/daoHost";
import { HAS_INTENTS } from "@/lib/config";
import { CashOut } from "@/components/CashOut";
import { savedStaffToken, useWallet } from "@/lib/wallet";
import { oneClickStatus } from "@/lib/oneclickClient";
import { intentsUsdcBalance } from "@/lib/intents";
import { Avatar, shortAccount } from "@/components/ui";
import { EventCard, fromChain, fromFree, type Item } from "@/components/EventCard";
import type { FreeEvent } from "@/lib/freeEventsShared";
import { SignInOptions } from "@/components/SignIn";
import { cohosts as cohostsApi } from "@/lib/cohostsClient";

export default function Me() {
  const { accountId } = useWallet();
  if (!accountId) return (
    <div className="gc-checkout space-y-6 mt-6">
      <div className="space-y-3"><p className="gc-eyebrow">Your corner of Nearvent</p><h1 className="gc-page-title">My events</h1><p className="text-muted">Your plans, passes and funds, all in one place. Sign in to pick up where you left off.</p></div>
      <SignInOptions />
    </div>
  );
  // Account changes get fresh state, so one guest never sees another guest's balances.
  return <MyEvents key={accountId} accountId={accountId} />;
}

function MyEvents({ accountId }: { accountId: string }) {
  const { kind, staffToken } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<bigint | null>(null);
  const [inIntents, setInIntents] = useState<bigint | null>(null);
  const [cashOutStatus, setCashOutStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  /** `ask`: a click may open the wallet for a fresh sign-in; loading the page never does. */
  const load = useCallback(async (ask = false) => {
    const issues: string[] = [];
    const results = await Promise.allSettled([
      events.balance(accountId).then((value) => setBalance(BigInt(value))),
      usdc.balance(accountId).then((value) => setWallet(BigInt(value))),
      HAS_INTENTS ? intentsUsdcBalance(accountId).then(setInIntents) : Promise.resolve(),
      (async () => {
        const now = Date.now();
        const [all, free] = await Promise.all([
          events.list(),
          // Wallets got their token at sign-in; after a day only a click (Try Again) asks again. Google/email proves here once.
          (kind !== "email" && !ask && !savedStaffToken(accountId) ? Promise.reject(new Error()) : staffToken())
            .then((token) => fetch("/api/free-events?mine=1", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
            .then(async (r) => r.ok ? (await r.json()).events as (FreeEvent & { going: boolean })[] : Promise.reject(new Error()))
            .catch((): (FreeEvent & { going: boolean })[] => {
              issues.push("Free events could not be loaded.");
              return [];
            }),
        ]);
        const ids = all.map((e) => e.id);
        const [statuses, teams] = await Promise.all([
          events.guestStatuses(accountId, ids),
          cohostsApi.many(ids).catch((): Record<number, string[]> => {
            issues.push("Door-team events could not be loaded.");
            return {};
          }),
        ]);
        // Council members of a DAO host manage its events too.
        const daoHosts = [...new Set(all.map((e) => e.host).filter(isDaoAccount))];
        const councils: Record<string, string[]> = Object.fromEntries(
          await Promise.all(daoHosts.map(async (h) => [h, await hostAccounts(h).catch(() => [])] as const)),
        );
        const hosts = (e: EventView) => e.host === accountId || !!councils[e.host]?.includes(accountId) || !!teams[e.id]?.includes(accountId);
        setMine([
          ...all.flatMap((e, i) => statuses[i] || hosts(e)
            ? [{ item: hosts(e) ? { ...fromChain(e), href: `/e/${e.id}/manage` } : fromChain(e), hosting: hosts(e) }] : []),
          ...free.map((e) => ({ item: fromFree(e, now), hosting: e.host === accountId })),
        ]);
      })(),
    ]);
    if (results[0].status === "rejected") { setBalance(null); issues.push("Your Nearvent balance is unavailable."); }
    if (results[1].status === "rejected") setWallet(null);
    if (results[2].status === "rejected") { setInIntents(null); issues.push("Your payment balance is unavailable."); }
    if (results[3].status === "rejected") { setMine(null); issues.push("Your events could not be loaded."); }
    setLoadErrors(issues);
  }, [accountId, kind, staffToken]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="max-w-5xl mx-auto space-y-10 pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><p className="gc-eyebrow">Your corner of Nearvent</p><h1 className="gc-page-title">My events</h1></div>
        <Link className="btn btn-accent" href="/create">Create event</Link>
      </div>
      {loadErrors.length > 0 && <div role="status" className="card p-4 space-y-2 text-sm"><p>{loadErrors.join(" ")}</p><button className="text-accent underline" onClick={() => void load(true)}>Try again</button></div>}
      {mine === null && loadErrors.length === 0 && <p className="text-muted" role="status">Finding your events…</p>}
      {mine !== null && <MyEventList mine={mine} />}
      <section id="funds" className="card p-6 sm:p-8 space-y-5 scroll-mt-24">
        <div className="space-y-2"><p className="gc-eyebrow">Your funds</p><h2 className="text-xl font-semibold">Nearvent balance</h2><p className="gc-price">{balance === null ? "—" : formatUsdc(balance)} <span className="text-base text-muted">USDC</span></p><p className="text-sm text-muted max-w-lg">Available payouts and refunds from all your events. Withdraw to a supported wallet and network.</p></div>
        {balance !== null && balance > 0n && <CashOut accountId={accountId} kind={kind} balance={balance} onDone={load} />}
        {inIntents !== null && inIntents > 0n && <div className="space-y-3 pt-4 border-t border-border"><p className="text-sm text-muted">Available in NEAR Intents: <b>{formatUsdc(inIntents)} USDC</b>. This balance is separate from event deposits.</p><CashOut accountId={accountId} kind={kind} balance={inIntents} onDone={load} fromIntents /></div>}
        {HAS_INTENTS && <button className="btn btn-ghost text-sm" disabled={checking} onClick={async () => {
          setChecking(true);
          try {
            const address = sessionStorage.getItem(`near-me:cashout:${accountId}`);
            if (!address) { setCashOutStatus("No pending withdrawal saved in this tab."); return; }
            const status = await oneClickStatus(address);
            setCashOutStatus(status ? `Withdrawal: ${status.toLowerCase().replaceAll("_", " ")}` : "Status unavailable. Check again shortly.");
            await load();
          } catch { setCashOutStatus("Could not check the withdrawal. Please try again."); }
          finally { setChecking(false); }
        }}>{checking ? "Checking…" : "Check last withdrawal"}</button>}
        {cashOutStatus && <p className="text-sm" role="status">{cashOutStatus}</p>}
      </section>
      <details className="card p-5"><summary className="cursor-pointer flex items-center gap-3"><Avatar account={accountId} size={32} /><span className="font-medium">{shortAccount(accountId)}</span><span className="ml-auto text-sm text-muted">Account</span></summary><div className="pt-4 space-y-2 text-sm text-muted"><p className="break-all">{accountId}</p>{kind !== "evm" && <p>USDC in your NEAR wallet: {wallet === null ? "Unavailable" : formatUsdc(wallet)}</p>}{inIntents !== null && <p>USDC in NEAR Intents: {formatUsdc(inIntents)}</p>}</div></details>
    </div>
  );
}

interface Mine { item: Item; hosting: boolean }

/** Events you joined or host, chain and free, as /events cards with an Upcoming/Past switch. */
function MyEventList({ mine }: { mine: Mine[] }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const shown = mine.filter((m) => m.item.past === (tab === "past"))
    .sort((a, b) => (tab === "upcoming" ? a.item.startsAt - b.item.startsAt : b.item.startsAt - a.item.startsAt));
  return (
    <section className="space-y-5">
      <div className="flex gap-1 rounded-full p-1 bg-border/40 w-fit" role="group" aria-label="When">
        {(["upcoming", "past"] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-full text-sm ${tab === t ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}>
            {t === "upcoming" ? "Upcoming" : "Past"}
          </button>
        ))}
      </div>
      {shown.length === 0 ? <div className="card p-6 space-y-3"><p className="text-muted">{tab === "upcoming" ? "Your next plan is out there." : "No past events yet."}</p><Link href="/events" className="text-accent font-medium text-sm">Explore events ↗</Link></div>
        : <div className="grid gap-5 grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3">{shown.map((m) => <EventCard key={m.item.key} item={m.item} tag={m.hosting ? "Hosting" : undefined} />)}</div>}
    </section>
  );
}
