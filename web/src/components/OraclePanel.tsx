"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bondPerSeatText, cameOf, events, formatUsdc, hostBondFor, isTicket, needsBond, registrationEndsAt, usdc, windowText, type DisputeView, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT, EXPLORER_URL, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { bondFromIntents, disputeFromIntents } from "@/lib/intents";
import { Avatar, shortAccount } from "@/components/ui";
import { ICONS, RegisterBox } from "@/components/EventSections";
import { checkIns, type CheckInEntry } from "@/lib/checkinsClient";
import { confirmAction } from "@/components/SlUi";
import { CLOCK_MARGIN_MS } from "@/lib/keeperPlan";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Time only when it is today: deadlines in a chip stay short. */
const soon = (ms: number) =>
  new Date(ms).toDateString() === new Date().toDateString()
    ? new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : when(ms);

/** Which permissionless call is due now, if any (mirrors the escrow's checks). */
export function dueCall(e: EventView, now = Date.now()): "settle" | "refund" | null {
  if (isTicket(e)) return null;
  if (e.status === "Open" && e.submit_by && now > e.submit_by) return "refund";
  if (e.status !== "Submitted") return null;
  const windowOver = now >= (e.challenge_ends_at ?? Infinity);
  return windowOver && ((e.open_disputes ?? 0) === 0 || now >= (e.resolve_by ?? Infinity)) ? "settle" : null;
}

/** A Bond or dispute paid through NEAR Intents lands a few receipts later: look a few times. */
async function settled(check: () => Promise<boolean>): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 1_500));
  }
  return check();
}

/**
 * The optimistic attendance part of a Deposit event: the host bond, the
 * published list with its dispute window, disputes and the DAO's verdicts,
 * and a "Settle" button anyone can press once the escrow allows it.
 */
export function OraclePanel({ event, guests, hostTeam, onChange, manage = false }: {
  event: EventView;
  guests: GuestView[];
  /** The host, or a DAO host's council. */
  hostTeam: string[];
  onChange: () => Promise<void> | void;
  /** On the Manage page the publish card already covers the host's next step. */
  manage?: boolean;
}) {
  const { accountId, kind, send } = useWallet();
  const [disputes, setDisputes] = useState<DisputeView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const autoRan = useRef(false);
  const filed = (event.open_disputes ?? 0) + (event.upheld_disputes ?? 0) + (event.dismissed_disputes ?? 0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!filed) return setDisputes([]);
    events.disputes(event.id).then(setDisputes).catch(() => {});
  }, [event.id, filed, event.status]);
  // The door log is frozen once the list is published; the council reads it here (proposals link to #checkins).
  const [doorLog, setDoorLog] = useState<CheckInEntry[] | "loading" | "error">("loading");
  const [linkedLog, setLinkedLog] = useState(false);
  useEffect(() => {
    if (event.status === "Open") return;
    checkIns.log(event.id).then(setDoorLog, () => setDoorLog("error"));
  }, [event.id, event.status]);
  useEffect(() => {
    if (!Array.isArray(doorLog) || window.location.hash !== "#checkins") return;
    setLinkedLog(true);
    document.getElementById("checkins")?.scrollIntoView();
  }, [doorLog]);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [onChange]);

  // The same clock margin as the keeper, so the button never shows before the keeper will act.
  const due = dueCall(event, now - CLOCK_MARGIN_MS);
  // The keeper normally does this; opening an overdue event nudges it once.
  useEffect(() => {
    if (!due || autoRan.current) return;
    autoRan.current = true;
    void fetch("/api/keeper/event", { method: "POST", body: JSON.stringify({ eventId: event.id }) })
      .then((r) => r.ok && r.json())
      .then((j) => j?.results?.some((x: { ok: boolean }) => x.ok) && onChange())
      .catch(() => {});
  }, [due, event.id, onChange]);

  // Without a court only the refund of an unpublished event is left here.
  if (isTicket(event) || (!event.dao && due !== "refund")) return null;

  /** USDC to the escrow with a message: from the wallet, or from NEAR Intents for EVM accounts. */
  const pay = async (amount: string, msg: Record<string, unknown>) => {
    if (!accountId) throw new Error("Sign in first.");
    if (kind === "evm") {
      if (msg.action === "host_bond") return bondFromIntents(accountId, event.id, amount);
      return disputeFromIntents(accountId, event.id, String(msg.target), Boolean(msg.attended), amount);
    }
    if (BigInt(await usdc.balance(accountId).catch(() => "0")) < BigInt(amount)) {
      throw new Error(`You need ${formatUsdc(amount)} USDC on NEAR for this.`);
    }
    const call: Call = {
      receiverId: USDC_CONTRACT,
      methodName: "ft_transfer_call",
      args: { receiver_id: EVENTS_CONTRACT, amount, msg: JSON.stringify(msg) },
      deposit: 1n,
      gas: 150_000_000_000_000n,
    };
    await send([call]);
  };

  const settleNow = (method: "settle" | "refund") => run(method, async () => {
    const r = await fetch("/api/keeper/event", { method: "POST", body: JSON.stringify({ eventId: event.id }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.results?.some((x: { ok: boolean }) => x.ok)) return;
    // The escrow does not allow it yet (or someone just did it): reload instead of sending a doomed call.
    if (r.ok && !j.busy) {
      const fresh = await events.get(event.id);
      if (!fresh || fresh.status !== event.status) return;
      if (!dueCall(fresh, Date.now() - CLOCK_MARGIN_MS)) {
        throw new Error(fresh.challenge_ends_at ? `Not yet: try again after ${when(fresh.challenge_ends_at + CLOCK_MARGIN_MS)}.` : "Not yet: try again in a minute.");
      }
    }
    // The relayer is busy or out of quota: anyone may call the escrow directly.
    if (!accountId || kind === "evm") throw new Error(j.error ?? "Could not settle right now. Try again in a minute.");
    await send([{ receiverId: EVENTS_CONTRACT, methodName: method, args: { event_id: event.id }, gas: 300_000_000_000_000n, deposit: 0n }]);
  });

  const isHost = !!accountId && hostTeam.includes(accountId);
  const me = guests.find((g) => g.account_id === accountId);
  const bond = hostBondFor(event);
  const deposit = `${formatUsdc(event.deposit)} USDC`;
  const windowOpen = event.status === "Submitted" && now < (event.challenge_ends_at ?? 0);
  const disputeOf = (account: string) => disputes.find((d) => d.target === account);
  const risk = `This locks ${deposit}. If the council agrees, you get it back plus part of the host bond (and your payout, if you came). If it disagrees, you lose it: half to the treasury, half to the guests who came.${event.resolve_by ? ` If it doesn't decide by ${when(event.resolve_by)}, you get it back.` : ""}`;
  const open = (target: string, attended: boolean) =>
    run(`dispute:${target}`, async () => {
      // "Didn't come?" is one tap in a list: say what it costs first.
      if (!attended && !(await confirmAction(`Report ${shortAccount(target)} as absent? ${risk}`, `Lock ${deposit}`))) return;
      await pay(event.deposit, { action: "dispute", event_id: event.id, target, attended });
      const took = await settled(async () => (await events.disputes(event.id)).some((d) => d.target === target));
      if (!took) throw new Error("The escrow did not take the dispute; your USDC came back.");
      // The council's proposals open now, not at the next keeper tick.
      void fetch("/api/keeper/event", { method: "POST", body: JSON.stringify({ eventId: event.id }) }).catch(() => {});
    });

  const box = (head: string, aside: React.ReactNode, children: React.ReactNode, top?: { icon?: string[]; title?: string; desc?: string; price?: string }) => (
    <RegisterBox id="who-came" head={head} aside={aside} {...top}>
      {children}
      {error && <p role="alert" className="text-sm text-warn break-words">{error}</p>}
    </RegisterBox>
  );

  const regEnd = registrationEndsAt(event);
  if (needsBond(event) && now < regEnd) {
    // Visitors already read "Registration opens once…" in the registration card.
    if (!isHost) return null;
    return box("Host bond", `Lock by ${soon(regEnd)}`, (
      <>
        <p className="text-sm text-muted">It comes back after the event, unless the council upholds a dispute or you publish no list in time.</p>
        {kind === "email" ? (
          <p className="text-sm text-warn">Google sign-in can’t send USDC yet. Lock the bond from a NEAR or EVM wallet.</p>
        ) : (
          <button className="btn btn-accent w-full" disabled={!!busy}
            onClick={() => run("bond", async () => {
              await pay(bond, { action: "host_bond", event_id: event.id });
              if (!(await settled(async () => (await events.get(event.id))?.host_bond !== "0"))) throw new Error("The escrow did not take the bond; your USDC came back.");
            })}>
            {busy === "bond" ? "Confirm in your wallet…" : `Lock ${formatUsdc(bond)} USDC Bond`}
          </button>
        )}
      </>
    ), { icon: ICONS.lock, title: "Opens registration", desc: bondPerSeatText(event), price: `${formatUsdc(bond)} USDC` });
  }

  if (needsBond(event) && event.status === "Open" && now < event.metadata.ends_at) {
    return box("Registration", "Never opened", (
      <p className="text-sm">
        {isHost
          ? `No bond was locked before the start, so nobody could register. Cancel the event ${manage ? "below" : "in Manage"}.`
          : "The host locked no bond, so registration never opened."}
      </p>
    ));
  }

  if (event.status === "Open" && now >= event.metadata.ends_at) {
    if (due === "refund") {
      const text = !event.dao
        ? `The host didn’t publish who came by ${when(event.submit_by!)}. Anyone can now refund every guest.`
        : event.guest_count === 0
          ? "Nobody registered. Anyone can close the event; the bond goes back to the host."
          : `The host didn’t publish who came by ${when(event.submit_by!)}, so the bond is lost. Start the refund: guests who came then have ${windowText(event)} to prove it. If nobody does, everyone gets the deposit back plus a share of the bond. If someone does, the guests who prove it split the pool.`;
      const label = !event.dao ? "Refund Everyone" : event.guest_count === 0 ? "Close Event" : "Start Refund";
      return box("Who came", "No list", (
        <>
          <p className="text-sm">{text}</p>
          <button className="btn btn-accent w-full" disabled={!!busy} onClick={() => settleNow("refund")}>{busy === "refund" ? "Starting…" : label}</button>
        </>
      ));
    }
    if (isHost && manage) return null;
    return box("Who came", `List due ${soon(event.submit_by!)}`, (
      <p className="text-sm text-muted">
        {isHost ? "Publish who came from Manage." : "The host publishes who came next."} Guests then have {windowText(event)} to dispute it.
      </p>
    ));
  }

  if (event.status !== "Submitted" && filed === 0) return null;

  const listed = guests.filter((g) => g.listed).length;
  const open_ = event.open_disputes ?? 0;
  const aside = event.status !== "Submitted"
    ? "Final"
    : windowOpen
      ? <span className="gc-chip" data-tone="accent">{event.abandoned ? "Proofs" : "Disputes"} until {soon(event.challenge_ends_at!)}</span>
      : open_ > 0 && now < (event.resolve_by ?? 0)
        ? <span className="gc-chip" data-tone="accent">Council decides by {soon(event.resolve_by!)}</span>
        : due
          ? <span className="gc-chip" data-tone="good">Ready to pay out</span>
          : <span className="gc-chip">Payouts in a minute</span>;
  const summary = event.status !== "Submitted"
    ? null
    : event.abandoned
      ? isHost
        ? "You published no list in time, so your bond is lost. Guests who came can still prove it."
        : "No list from the host. Guests who prove they came split the pool. If nobody does, everyone gets the deposit back plus a share of the host bond."
      : `${isHost ? "You" : "The host"} marked ${listed} of ${event.guest_count} as came.${isHost && BigInt(event.host_bond ?? "0") > 0n ? ` Your ${formatUsdc(event.host_bond!)} USDC bond comes back unless the council upholds a dispute.` : ""}`;

  const absent = me && windowOpen && !me.listed && !disputeOf(me.account_id);
  const myCheckIn = absent && Array.isArray(doorLog) && doorLog.some((x) => x.account === me.account_id && x.on);

  /** One verdict word per dispute; the row's subline says what was claimed. */
  const verdict = (d: DisputeView): [string, string | undefined] =>
    d.upheld === true ? ["Upheld", d.attended ? "good" : "warn"]
      : d.upheld === false ? ["Dismissed", undefined]
        : event.status === "Submitted" && now < (event.resolve_by ?? 0) ? ["Waiting", "accent"]
          : ["Expired", undefined];

  return box("Who came", aside, (
    <>
      {summary && <p className="text-sm">{summary}</p>}
      {absent && (
        <div className="rounded-2xl border border-warn/40 bg-warn/10 p-3 space-y-2">
          <p className="font-semibold text-warn">{event.abandoned ? "No list from the host" : "You’re not on the host’s list"}</p>
          <p className="text-sm">
            Came? Open a dispute by <b>{when(event.challenge_ends_at!)}</b>.
            {myCheckIn ? " The door log below shows your check-in." : ""}
            {event.abandoned ? " If another guest proves it and you don’t, your deposit goes to them." : ""}
          </p>
          <p className="text-xs text-muted leading-relaxed">
            It locks {deposit}. If the council agrees, you get it back plus part of the host bond and your payout. If it disagrees, you lose it.
            {event.resolve_by ? ` No decision by ${when(event.resolve_by)}: it comes back.` : ""}
          </p>
          <button className="btn btn-accent w-full sm:w-auto" disabled={!!busy} onClick={() => open(me!.account_id, true)}>
            {busy === `dispute:${me!.account_id}` ? "Confirm in your wallet…" : "I Came: Open a Dispute"}
          </button>
        </div>
      )}
      {due === "settle" && (
        <button className="btn btn-accent w-full" disabled={!!busy} onClick={() => settleNow("settle")}>{busy === "settle" ? "Settling…" : "Settle Payouts"}</button>
      )}
      <div>
        <details className="gc-fold" open={guests.length <= 12 || (windowOpen && !!me) || disputes.length > 0}>
          <summary>Host’s list <span className="gc-chip">{listed} of {guests.length} came</span></summary>
          <ul className="pb-2 max-h-96 overflow-y-auto">
            {guests.map((g) => {
              const d = disputeOf(g.account_id);
              const canDispute = windowOpen && me && !d && g.account_id !== me.account_id && g.listed;
              const came = cameOf(event, g);
              const [chip, tone] = d ? verdict(d) : came ? ["Came", "good"] : [event.status === "Submitted" ? "Not on list" : "No-show", undefined];
              return (
                <li key={g.account_id} className="flex items-center gap-3 py-1.5 min-h-12">
                  <Avatar account={g.account_id} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate" data-tooltip={g.account_id}>{g.account_id === accountId ? "You" : shortAccount(g.account_id)}</span>
                    {d && (
                      <span className="block text-xs text-muted truncate">
                        {d.attended ? (g.account_id === accountId ? "you say you came" : "says they came") : `${d.challenger === accountId ? "you say" : `${shortAccount(d.challenger)} says`} absent`}
                      </span>
                    )}
                  </span>
                  {canDispute ? (
                    <button className="shrink-0 min-h-11 px-2 -mr-2 rounded-lg text-sm text-muted underline underline-offset-2 decoration-border hover:text-text disabled:opacity-50" disabled={!!busy} onClick={() => open(g.account_id, false)}>
                      {busy === `dispute:${g.account_id}` ? "Confirm…" : "Report Absence"}
                    </button>
                  ) : (
                    <span className="gc-chip" data-tone={tone}>{chip}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
        {disputes.length > 0 && (
          <p className="text-xs text-muted pb-3">
            Disputes go to the council at{" "}
            <a className="underline underline-offset-2" href={`${EXPLORER_URL}/address/${event.dao}`} target="_blank" rel="noopener">{shortAccount(event.dao ?? "")}</a>{" "}
            (3 of 5 votes).
          </p>
        )}
        <details id="checkins" className="gc-fold scroll-mt-24" open={linkedLog || disputes.length > 0 || !!myCheckIn}>
          <summary>Door check-in log {Array.isArray(doorLog) && <span className="gc-chip">{doorLog.length}</span>}</summary>
          {doorLog === "loading" ? (
            <p className="pb-3 text-sm text-muted">Loading the door log…</p>
          ) : doorLog === "error" ? (
            <p className="pb-3 text-sm text-warn">Couldn’t load the door log. Reload to try again.</p>
          ) : doorLog.length ? (
            <ul className="pb-3 space-y-1 text-sm max-h-80 overflow-y-auto">
              {doorLog.map((x, i) => (
                <li key={i} className="flex gap-3">
                  <span className="font-mono text-xs text-muted tabular-nums shrink-0 pt-0.5 min-w-16" data-tooltip={when(x.at)}>{soon(x.at)}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span data-tooltip={x.account}>{shortAccount(x.account)}</span> <span className={x.on ? "text-good" : "text-warn"}>{x.on ? "checked in" : "unchecked"}</span>
                    <span className="text-muted"> · by {shortAccount(x.by)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="pb-3 text-sm text-muted">No door check-ins were recorded for this event.</p>
          )}
        </details>
      </div>
    </>
  ));
}
