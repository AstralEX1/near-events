"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView } from "@/lib/near";
import { HAS_INTENTS } from "@/lib/config";
import { CashOut } from "@/components/CashOut";
import { useWallet } from "@/lib/wallet";
import { oneClickStatus } from "@/lib/oneclickClient";
import { intentsUsdcBalance } from "@/lib/intents";
import { Avatar, Cover, shortAccount } from "@/components/ui";
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
  const { kind } = useWallet();
  const [balance, setBalance] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<bigint | null>(null);
  const [inIntents, setInIntents] = useState<bigint | null>(null);
  const [cashOutStatus, setCashOutStatus] = useState("");
  const [checking, setChecking] = useState(false);
  const [mine, setMine] = useState<EventView[] | null>(null);
  const [doorTeams, setDoorTeams] = useState<Record<number, string[]>>({});
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    const issues: string[] = [];
    const results = await Promise.allSettled([
      events.balance(accountId).then((value) => setBalance(BigInt(value))),
      usdc.balance(accountId).then((value) => setWallet(BigInt(value))),
      HAS_INTENTS ? intentsUsdcBalance(accountId).then(setInIntents) : Promise.resolve(),
      (async () => {
        const all = await events.list();
        const ids = all.map((e) => e.id);
        const [statuses, teams] = await Promise.all([
          events.guestStatuses(accountId, ids),
          cohostsApi.many(ids).catch((): Record<number, string[]> => {
            issues.push("Door-team events could not be loaded.");
            return {};
          }),
        ]);
        setDoorTeams(teams);
        setMine(all.filter((e, i) => statuses[i] || e.host === accountId || teams[e.id]?.includes(accountId)));
      })(),
    ]);
    if (results[0].status === "rejected") { setBalance(null); issues.push("Your Nearvent balance is unavailable."); }
    if (results[1].status === "rejected") setWallet(null);
    if (results[2].status === "rejected") { setInIntents(null); issues.push("Your payment balance is unavailable."); }
    if (results[3].status === "rejected") { setMine(null); issues.push("Your events could not be loaded."); }
    setLoadErrors(issues);
  }, [accountId]);

  useEffect(() => { void load(); }, [load]);

  const upcoming = mine?.filter((e) => e.status === "Open" && e.metadata.ends_at > Date.now()).sort((a, b) => a.metadata.starts_at - b.metadata.starts_at)[0];
  const hostOf = (e: EventView) => e.host === accountId || doorTeams[e.id]?.includes(accountId);

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2"><p className="gc-eyebrow">Your corner of Nearvent</p><h1 className="gc-page-title">My events</h1></div>
        <Link className="btn btn-accent" href="/create">Create event</Link>
      </div>
      {loadErrors.length > 0 && <div role="status" className="card p-4 space-y-2 text-sm"><p>{loadErrors.join(" ")}</p><button className="text-accent underline" onClick={() => void load()}>Try again</button></div>}
      {upcoming && <Link href={`/e/${upcoming.id}${hostOf(upcoming) ? "/manage" : ""}`} className="gc-next-event flex items-center gap-5 p-5 sm:p-7 rounded-3xl bg-accent-soft">
        <Cover event={upcoming} className="w-20 h-20 sm:w-28 sm:h-28 rounded-2xl shrink-0" />
        <div className="min-w-0 space-y-2"><p className="gc-eyebrow">Up next</p><h2 className="text-xl sm:text-2xl font-semibold break-words">{upcoming.metadata.title}</h2><p className="text-sm text-muted">{new Date(upcoming.metadata.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p><p className="text-sm text-accent font-medium">{hostOf(upcoming) ? "Open host tools" : "View your pass"} ↗</p></div>
      </Link>}
      {mine === null && loadErrors.length === 0 && <p className="text-muted" role="status">Finding your events…</p>}
      {mine !== null && <MyEventTabs going={mine.filter((e) => !hostOf(e))} hosted={mine.filter(hostOf)} />}
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

/** "My Events" are events you joined; "Hosted Events" appears once you host one, and opens it directly when it is the only one. */
function MyEventTabs({ going, hosted }: { going: EventView[]; hosted: EventView[] }) {
  const [tab, setTab] = useState<"going" | "hosted">("going");
  const list = tab === "hosted" ? hosted : going;
  const tabClass = (on: boolean) => `h-11 -mb-px border-b-2 ${on ? "border-text font-semibold" : "border-transparent text-muted"}`;
  return (
    <section className="space-y-4">
      <div className="flex gap-6 border-b border-border" role="group" aria-label="Your events">
        <button className={tabClass(tab === "going")} aria-pressed={tab === "going"} onClick={() => setTab("going")}>My Events</button>
        {hosted.length === 1 ? <Link className={tabClass(false)} href={`/e/${hosted[0].id}/manage`}>Hosted Events</Link>
          : hosted.length > 1 && <button className={tabClass(tab === "hosted")} aria-pressed={tab === "hosted"} onClick={() => setTab("hosted")}>Hosted Events</button>}
      </div>
      {list.length === 0 ? <div className="card p-6 space-y-3"><p className="text-muted">Your next plan is out there.</p><Link href="/events" className="text-accent font-medium text-sm">Explore events ↗</Link></div> : <div className="grid gap-3 sm:grid-cols-2">{[...list].sort((a, b) => b.metadata.starts_at - a.metadata.starts_at).map((e) => (
        <Link key={e.id} href={`/e/${e.id}${tab === "hosted" ? "/manage" : ""}`} className="gc-list-card flex gap-4 items-center p-4">
          <Cover event={e} className="w-16 h-16 rounded-xl shrink-0" />
          <div className="min-w-0"><h3 className="font-semibold break-words">{e.metadata.title}</h3><p className="text-sm text-muted mt-1">{new Date(e.metadata.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{e.status !== "Open" && ` · ${e.status === "Finalized" ? "Closed" : "Cancelled"}`}</p></div>
        </Link>
      ))}</div>}
    </section>
  );
}
