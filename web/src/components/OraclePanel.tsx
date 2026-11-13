"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bondPerSeatText, events, formatUsdc, hostBondFor, isTicket, needsBond, registrationEndsAt, usdc, windowText, type DisputeView, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT, EXPLORER_URL, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { bondFromIntents, disputeFromIntents } from "@/lib/intents";
import { shortAccount } from "@/components/ui";
import { checkIns, type CheckInEntry } from "@/lib/checkinsClient";
import { confirmAction } from "@/components/SlUi";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

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
export function OraclePanel({ event, guests, hostTeam, onChange }: {
  event: EventView;
  guests: GuestView[];
  /** The host, or a DAO host's council. */
  hostTeam: string[];
  onChange: () => Promise<void> | void;
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
  useEffect(() => {
    if (event.status === "Open") return;
    checkIns.log(event.id).then(setDoorLog, () => setDoorLog("error"));
  }, [event.id, event.status]);
  useEffect(() => {
    if (Array.isArray(doorLog) && window.location.hash === "#checkins") document.getElementById("checkins")?.scrollIntoView();
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

  const due = dueCall(event, now);
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
      if (!dueCall(fresh, Date.now() - 60_000)) {
        throw new Error(fresh.challenge_ends_at ? `Not yet: try again after ${when(fresh.challenge_ends_at + 60_000)}.` : "Not yet: try again in a minute.");
      }
    }
    // The relayer is busy or out of quota: anyone may call the escrow directly.
    if (!accountId || kind === "evm") throw new Error(j.error ?? "Could not settle right now. Try again in a minute.");
    await send([{ receiverId: EVENTS_CONTRACT, methodName: method, args: { event_id: event.id }, gas: 300_000_000_000_000n, deposit: 0n }]);
  });

  const isHost = !!accountId && hostTeam.includes(accountId);
  const me = guests.find((g) => g.account_id === accountId);
  const bond = hostBondFor(event);
  const windowOpen = event.status === "Submitted" && now < (event.challenge_ends_at ?? 0);
  const disputeOf = (account: string) => disputes.find((d) => d.target === account);
  const risk = `This locks ${formatUsdc(event.deposit)} USDC. If the council agrees, you get it back plus part of the host bond (and your payout, if you came). If it disagrees, you lose it: half to the treasury, half to the guests who came.${event.resolve_by ? ` If it doesn't decide by ${when(event.resolve_by)}, you get it back.` : ""}`;
  const open = (target: string, attended: boolean) =>
    run(`dispute:${target}`, async () => {
      // "Didn't come?" is one tap in a list: say what it costs first.
      if (!attended && !(await confirmAction(`Report ${shortAccount(target)} as absent? ${risk}`, `Lock ${formatUsdc(event.deposit)} USDC`))) return;
      await pay(event.deposit, { action: "dispute", event_id: event.id, target, attended });
      const took = await settled(async () => (await events.disputes(event.id)).some((d) => d.target === target));
      if (!took) throw new Error("The escrow did not take the dispute; your USDC came back.");
      // The council's proposals open now, not at the next keeper tick.
      void fetch("/api/keeper/event", { method: "POST", body: JSON.stringify({ eventId: event.id }) }).catch(() => {});
    });

  const verdict = (d: DisputeView) =>
    d.upheld === true ? <span className="text-good">upheld</span>
      : d.upheld === false ? <span className="text-warn">dismissed</span>
        : event.status === "Submitted" && now < (event.resolve_by ?? 0) ? <span className="text-muted">waiting for the council</span>
          : <span className="text-muted">expired, the list stands</span>;

  let body: React.ReactNode = null;
  if (needsBond(event) && now < registrationEndsAt(event)) {
    // Visitors already read "Registration opens once…" in the registration card.
    body = isHost ? (
      <div className="space-y-2">
        <p className="text-sm">
          Lock a host bond of <b>{formatUsdc(bond)} USDC</b> ({bondPerSeatText(event)}) before the event starts to open
          registration. You get it back after the event unless the council upholds a dispute or you publish no list by the deadline.
        </p>
        {kind === "email" ? (
          <p className="text-xs text-muted">Google sign-in can’t send USDC yet: lock the bond from a NEAR or EVM wallet.</p>
        ) : (
          <button className="btn btn-accent" disabled={!!busy}
            onClick={() => run("bond", async () => {
              await pay(bond, { action: "host_bond", event_id: event.id });
              if (!(await settled(async () => (await events.get(event.id))?.host_bond !== "0"))) throw new Error("The escrow did not take the bond; your USDC came back.");
            })}>
            {busy === "bond" ? "Confirm in your wallet…" : `Lock ${formatUsdc(bond)} USDC Bond`}
          </button>
        )}
      </div>
    ) : null;
  } else if (needsBond(event) && event.status === "Open" && now < event.metadata.ends_at) {
    body = (
      <p className="text-sm text-muted">
        {isHost ? "Registration never opened: no bond was locked before the start. You can cancel the event in Manage." : "Registration never opened for this event."}
      </p>
    );
  } else if (event.status === "Open" && Date.now() >= event.metadata.ends_at) {
    const refundText = !event.dao
      ? `The host did not publish who came by ${when(event.submit_by!)}. Anyone can now refund every guest.`
      : event.guest_count === 0
        ? "Nobody registered. Anyone can close the event; the host bond goes back to the host."
        : `The host didn’t publish who came by ${when(event.submit_by!)} and loses the bond. Start the refund to publish an empty list. Guests who came then have ${windowText(event)} to prove it. If nobody does, everyone gets the deposit back plus a share of the bond. If someone does, the guests who proved it split the pool.`;
    const refundLabel = !event.dao ? "Refund Everyone" : event.guest_count === 0 ? "Close Event" : "Start Refund";
    body = due === "refund" ? (
      <div className="space-y-2">
        <p className="text-sm">{refundText}</p>
        <button className="btn btn-accent" disabled={!!busy} onClick={() => settleNow("refund")}>{busy === "refund" ? "Starting…" : refundLabel}</button>
      </div>
    ) : (
      <p className="text-sm text-muted">
        {isHost ? "Publish who came from Manage" : "The host publishes who came"} by {when(event.submit_by!)}. Then guests have {windowText(event)} to dispute it.
      </p>
    );
  } else if (event.status === "Submitted" || filed > 0) {
    const absent = me && event.status === "Submitted" && !me.listed && !disputeOf(me.account_id);
    body = (
      <div className="space-y-3">
        {event.status === "Submitted" && (
          <p className="text-sm">
            {event.abandoned
              ? "The host published no list. If nobody proves they came, everyone gets the deposit back plus a share of the host bond. Guests who prove it split the pool. "
              : `The host published who came: ${guests.filter((g) => g.listed).length} of ${event.guest_count}. `}
            {windowOpen
              ? <>Guests can dispute a record until <b>{when(event.challenge_ends_at!)}</b>. Then anyone can settle the payouts{(event.open_disputes ?? 0) > 0 ? ", once the council decides" : ""}.</>
              : (event.open_disputes ?? 0) > 0 && now < (event.resolve_by ?? 0)
                ? <>The council is deciding {event.open_disputes} dispute{event.open_disputes === 1 ? "" : "s"} (by {when(event.resolve_by!)}).</>
                : <>The dispute window is over: the payout can be settled now.</>}
          </p>
        )}
        {absent && windowOpen && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 space-y-2">
            <p className="text-sm font-medium text-warn">{event.abandoned ? "The host published no list." : "You were marked as not coming."}</p>
            <p className="text-sm">
              If you came, open a dispute before {when(event.challenge_ends_at!)} and send the council your check-in or other proof.
              {event.abandoned ? " If another guest proves it and you don’t, your deposit goes to them." : ""} {risk}
            </p>
            <button className="btn btn-accent" disabled={!!busy} onClick={() => open(me!.account_id, true)}>
              {busy === `dispute:${me!.account_id}` ? "Confirm in your wallet…" : "I Came: Open a Dispute"}
            </button>
          </div>
        )}
        <details className="text-sm" open={windowOpen && !!me}>
          <summary className="cursor-pointer font-medium">Host’s list: {guests.filter((g) => g.listed).length} of {guests.length} came</summary>
          <ul className="mt-2 divide-y divide-border max-h-96 overflow-y-auto">
            {guests.map((g) => {
              const d = disputeOf(g.account_id);
              const canDispute = windowOpen && me && !d && g.account_id !== me.account_id && g.listed;
              return (
                <li key={g.account_id} className="py-1.5 flex items-center gap-2">
                  <span className={g.listed ? "text-good" : "text-muted"}>{g.listed ? "✓" : "✗"}</span>
                  <span className="truncate min-w-0" data-tooltip={g.account_id}>{shortAccount(g.account_id)}</span>
                  {d && <span className="text-xs ml-1 shrink-0 whitespace-nowrap">disputed · {verdict(d)}</span>}
                  {canDispute && (
                    <button className="ml-auto shrink-0 whitespace-nowrap text-xs underline underline-offset-2" disabled={!!busy}
                      onClick={() => open(g.account_id, false)}>
                      {busy === `dispute:${g.account_id}` ? "Confirm…" : "Report Absence"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
        {disputes.length > 0 && (
          <div id="disputes" className="text-sm space-y-1">
            <div className="font-medium">Disputes</div>
            {disputes.map((d) => (
              <p key={d.target} className="text-muted">
                <span className="[overflow-wrap:anywhere]">{d.attended ? `${shortAccount(d.target)} says they came` : `${shortAccount(d.challenger)} says ${shortAccount(d.target)} did not come`}</span> · {verdict(d)}
              </p>
            ))}
            <p className="text-xs text-muted">
              Decided by the council of{" "}
              <a className="underline" href={`${EXPLORER_URL}/address/${event.dao}`} target="_blank" rel="noopener">{shortAccount(event.dao ?? "")}</a>{" "}
              (3 of 5 votes).
            </p>
          </div>
        )}
        {due === "settle" && (
          <button className="btn btn-accent" disabled={!!busy} onClick={() => settleNow("settle")}>{busy === "settle" ? "Settling…" : "Settle Payouts"}</button>
        )}
        <details id="checkins" className="text-sm" open={disputes.length > 0}>
          <summary className="cursor-pointer font-medium">Door check-in log{Array.isArray(doorLog) ? ` (${doorLog.length})` : ""}</summary>
          {doorLog === "loading" ? (
            <p className="mt-2 text-muted">Loading the door log…</p>
          ) : doorLog === "error" ? (
            <p className="mt-2 text-warn">Couldn’t load the door log. Reload to try again.</p>
          ) : doorLog.length ? (
            <ul className="mt-2 space-y-0.5 text-muted max-h-80 overflow-y-auto">
              {doorLog.map((x, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {when(x.at)} · <span data-tooltip={x.account}>{shortAccount(x.account)}</span> {x.on ? "checked in" : "unchecked"} by {shortAccount(x.by)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">No door check-ins were recorded for this event.</p>
          )}
        </details>
      </div>
    );
  }
  if (!body) return null;
  return (
    <section className="card p-4 space-y-2">
      {body}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
    </section>
  );
}
