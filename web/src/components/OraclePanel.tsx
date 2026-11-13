"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { events, formatUsdc, hostBondFor, isTicket, needsBond, registrationEndsAt, usdc, type DisputeView, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT, EXPLORER_URL, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { bondFromIntents, disputeFromIntents } from "@/lib/intents";
import { shortAccount } from "@/components/ui";
import { checkIns, type CheckInEntry } from "@/lib/checkinsClient";

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
  const [doorLog, setDoorLog] = useState<CheckInEntry[] | null>(null);
  useEffect(() => {
    if (event.status === "Open") return;
    checkIns.log(event.id).then(setDoorLog).catch(() => {});
  }, [event.id, event.status]);
  useEffect(() => {
    if (doorLog && window.location.hash === "#checkins") document.getElementById("checkins")?.scrollIntoView();
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

  if (isTicket(event) || !event.dao) return null;

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
      if (!fresh || !dueCall(fresh, Date.now() - 60_000)) return;
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
  const open = (target: string, attended: boolean) =>
    run(`dispute:${target}`, () => pay(event.deposit, { action: "dispute", event_id: event.id, target, attended }).then(async () => {
      const fresh = await events.disputes(event.id);
      if (!fresh.some((d) => d.target === target)) throw new Error("The escrow did not take the dispute; your USDC came back.");
      // The council's proposals open now, not at the next keeper tick.
      void fetch("/api/keeper/event", { method: "POST", body: JSON.stringify({ eventId: event.id }) }).catch(() => {});
    }));
  const risk = `It locks ${formatUsdc(event.deposit)} USDC. If the council agrees, you get it back plus a share of the host bond; if not, half goes to the treasury and half to the people who came.`;

  const verdict = (d: DisputeView) =>
    d.upheld === true ? <span className="text-good">upheld</span>
      : d.upheld === false ? <span className="text-warn">dismissed</span>
        : event.status === "Submitted" && now < (event.resolve_by ?? 0) ? <span className="text-muted">waiting for the council</span>
          : <span className="text-muted">expired, the list stands</span>;

  let body: React.ReactNode = null;
  if (needsBond(event) && now < registrationEndsAt(event)) {
    body = isHost ? (
      <div className="space-y-2">
        <p className="text-sm">
          Lock a host bond of <b>{formatUsdc(bond)} USDC</b> (one deposit per seat) to open registration before the
          event starts. You get it back after the event, unless a guest proves your list wrong to the council.
        </p>
        {kind === "email" ? (
          <p className="text-xs text-muted">Google sign-in can’t send USDC yet: lock the bond from a NEAR or EVM wallet.</p>
        ) : (
          <button className="btn btn-accent" disabled={!!busy}
            onClick={() => run("bond", () => pay(bond, { action: "host_bond", event_id: event.id }).then(async () => {
              const fresh = await events.get(event.id);
              if (fresh?.host_bond === "0") throw new Error("The escrow did not take the bond; your USDC came back.");
            }))}>
            {busy === "bond" ? "Confirm in your wallet…" : `Lock ${formatUsdc(bond)} USDC bond`}
          </button>
        )}
      </div>
    ) : (
      <p className="text-sm text-muted">Registration opens once the host locks a {formatUsdc(bond)} USDC bond.</p>
    );
  } else if (event.status === "Open" && Date.now() >= event.metadata.ends_at) {
    body = due === "refund" ? (
      <div className="space-y-2">
        <p className="text-sm">
          The host did not publish who came by {when(event.submit_by!)}, so the host bond is lost. Anyone can start the
          refund: it publishes an empty list, and for 12 hours guests who came can still prove it. Everyone else gets the
          deposit back with a share of the bond.
        </p>
        <button className="btn btn-accent" disabled={!!busy} onClick={() => settleNow("refund")}>{busy === "refund" ? "Starting…" : "Start the refund"}</button>
      </div>
    ) : (
      <p className="text-sm text-muted">
        {isHost ? "Publish who came from Manage" : "The host publishes who came"} by {when(event.submit_by!)}. Then guests have 12 hours to dispute it.
      </p>
    );
  } else if (event.status === "Submitted" || filed > 0) {
    const absent = me && event.status === "Submitted" && !me.listed && !disputeOf(me.account_id);
    body = (
      <div className="space-y-3">
        {event.status === "Submitted" && (
          <p className="text-sm">
            {event.abandoned
              ? "The host published no list, so everyone is refunded with a share of the host bond, unless guests who came prove it. "
              : `The host published who came: ${event.attended_count} of ${event.guest_count}. `}
            {windowOpen
              ? <>Guests can dispute a record until <b>{when(event.challenge_ends_at!)}</b>; then the pool is paid out.</>
              : (event.open_disputes ?? 0) > 0 && now < (event.resolve_by ?? 0)
                ? <>The council is deciding {event.open_disputes} dispute{event.open_disputes === 1 ? "" : "s"} (by {when(event.resolve_by!)}).</>
                : <>The dispute window is over: the payout can be settled now.</>}
          </p>
        )}
        {absent && windowOpen && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 space-y-2">
            <p className="text-sm font-medium text-warn">{event.abandoned ? "The host published no list." : "You were marked as not coming."}</p>
            <p className="text-sm">If you came, open a dispute before {when(event.challenge_ends_at!)}. {risk} Send the council your check-in or other proof.</p>
            <button className="btn btn-accent" disabled={!!busy} onClick={() => open(me!.account_id, true)}>
              {busy === `dispute:${me!.account_id}` ? "Confirm in your wallet…" : "I came: open a dispute"}
            </button>
          </div>
        )}
        <details className="text-sm" open={windowOpen && !!me}>
          <summary className="cursor-pointer font-medium">Published list ({guests.length})</summary>
          <ul className="mt-2 divide-y divide-border">
            {guests.map((g) => {
              const d = disputeOf(g.account_id);
              const canDispute = windowOpen && me && !d && g.account_id !== me.account_id && g.listed;
              return (
                <li key={g.account_id} className="py-1.5 flex items-center gap-2">
                  <span className={g.listed ? "text-good" : "text-muted"}>{g.listed ? "✓" : "✗"}</span>
                  <span className="truncate">{shortAccount(g.account_id)}</span>
                  {d && <span className="text-xs ml-1">disputed · {verdict(d)}</span>}
                  {canDispute && (
                    <button className="ml-auto text-xs underline underline-offset-2" disabled={!!busy}
                      data-tooltip={risk}
                      onClick={() => open(g.account_id, false)}>
                      {busy === `dispute:${g.account_id}` ? "Confirm…" : "Didn’t come?"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
        <details id="checkins" className="text-sm" open={disputes.length > 0}>
          <summary className="cursor-pointer font-medium">Door check-in log ({doorLog?.length ?? 0})</summary>
          {doorLog?.length ? (
            <ul className="mt-2 space-y-0.5 text-muted">
              {doorLog.map((x, i) => (
                <li key={i}>{when(x.at)} · {shortAccount(x.account)} {x.on ? "checked in" : "unchecked"} by {shortAccount(x.by)}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-muted">No door check-ins were recorded for this event.</p>
          )}
        </details>
        {disputes.length > 0 && (
          <div id="disputes" className="text-sm space-y-1">
            <div className="font-medium">Disputes</div>
            {disputes.map((d) => (
              <p key={d.target} className="text-muted">
                {d.attended ? `${shortAccount(d.target)} says they came` : `${shortAccount(d.challenger)} says ${shortAccount(d.target)} did not come`} · {verdict(d)}
              </p>
            ))}
            <p className="text-xs text-muted">
              Decided by the council of{" "}
              <a className="underline" href={`${EXPLORER_URL}/address/${event.dao}`} target="_blank" rel="noopener">{shortAccount(event.dao)}</a>{" "}
              (3 of 5 votes).
            </p>
          </div>
        )}
        {due === "settle" && (
          <button className="btn btn-accent" disabled={!!busy} onClick={() => settleNow("settle")}>{busy === "settle" ? "Settling…" : "Settle payouts"}</button>
        )}
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
