"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, hostBondFor, hoursText, needsBond, registrationEndsAt, registrationOpen, windowText, bondPerSeatText, voidedByCouncil, type EventView, type GuestStatus, isTicket } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { NextSteps } from "@/components/EventParts";
import { CashOut } from "@/components/CashOut";
import { DepositRulesTooltip } from "@/components/DepositRulesTooltip";
import { OneTapCheckout } from "@/components/OneTapCheckout";
import { ruleText, type AccessCheck } from "@/lib/access";

/** Sign in, then put down the deposit. Used on the event page and in the embed popup. */
export function RegistrationCard({
  event,
  myStatus,
  onChange,
  explain = true,
}: {
  event: EventView;
  myStatus: GuestStatus | null;
  onChange: () => Promise<void>;
  /** The embed pop-up's own path; the checkout no longer leaves the card, so it is unused. */
  embedReturnTo?: string;
  /** The event page shows a one-line summary above instead of the long rule text. */
  explain?: boolean;
}) {
  const { accountId, kind } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceState, setBalanceState] = useState<"loading" | "ready" | "error">("loading");
  const [balanceAccountId, setBalanceAccountId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  // The escrow's verdict under the event's access rule; it refunds a refused registration.
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const loadBalance = useCallback(async () => {
    if (!accountId) {
      setBalance(0n);
      setBalanceAccountId(null);
      setBalanceState("ready");
      return;
    }
    setBalanceAccountId(null);
    setBalanceState("loading");
    try {
      setBalance(BigInt(await events.balance(accountId)));
      setBalanceAccountId(accountId);
      setBalanceState("ready");
    } catch {
      setBalanceAccountId(accountId);
      setBalanceState("error");
    }
  }, [accountId]);

  const refreshAfterSignIn = () => {
    void onChange().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  const rule = event.access ?? null;
  useEffect(() => {
    setAccess(null);
    if (!accountId || !rule || myStatus) return;
    let live = true;
    events.checkAccess(event.id, accountId).then((c) => live && setAccess(c)).catch(() => {});
    return () => {
      live = false;
    };
  }, [accountId, event.id, rule, myStatus]);

  const balanceLoading = !accountId || balanceAccountId !== accountId || balanceState === "loading";
  const balanceError = balanceAccountId === accountId && balanceState === "error";

  const price = `${formatUsdc(event.deposit)} USDC`;
  const ticket = isTicket(event);
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled" && ticket) {
    body = <p className="text-sm">This event was cancelled. Tickets are not refunded.</p>;
  } else if (event.status === "Submitted") {
    // The "Who came" panel below has the list, the deadline and the dispute button.
    body = (
      <p className="text-sm">
        {!myStatus ? "This event is over." : event.abandoned ? "The host published no list." : "The host published who came."} Payouts come after the dispute window.
      </p>
    );
  } else if (event.status === "Refunded") {
    // `refund` with no guests: the event just closed and the bond went back to the host.
    body = <p className="text-sm">Nobody registered for this event, so it closed.</p>;
  } else if (event.status === "Cancelled") {
    body = (
      <div className="space-y-2">
        <p className="text-sm">
          {voidedByCouncil(event)
            ? `Cancelled by the council · everyone got their deposit back.${myStatus ? " Yours is in your Nearvent balance." : ""}`
            : "This event was cancelled. Refunds were credited to guests’ Nearvent balances."}
        </p>
        {!accountId ? (
          <SignInFolded hint="Registered? Sign in to see your refund." onDone={refreshAfterSignIn} />
        ) : balanceLoading ? (
          <p className="text-sm text-muted">Checking your refund…</p>
        ) : balanceError ? (
          <p className="text-sm text-warn">Could not load your refund. Refresh and try again.</p>
        ) : balance > 0n ? (
          <CashOut accountId={accountId} kind={kind} balance={balance} onDone={loadBalance} startOpen />
        ) : null}
      </div>
    );
  } else if (event.status === "Finalized") {
    body = ticket ? (
      <p className="text-sm">This event is over. Thanks for coming.</p>
    ) : !accountId ? (
      <SignInFolded hint="Went to this event? Sign in to see your payout." onDone={refreshAfterSignIn} />
    ) : event.attended_count === 0 && myStatus ? (
      <div className="space-y-2">
        <p className="text-sm">Nobody was checked in. Your deposit was credited to Nearvent.</p>
        {balanceLoading ? (
          <p className="text-sm text-muted">Checking your deposit balance…</p>
        ) : balanceError ? (
          <p className="text-sm text-warn">Could not load your balance. Refresh and try again.</p>
        ) : balance > 0n ? (
          <CashOut accountId={accountId} kind={kind} balance={balance} onDone={loadBalance} startOpen />
        ) : null}
      </div>
    ) : myStatus === "Attended" ? (
        balanceLoading ? (
          <p className="text-sm text-muted">Checking your payout…</p>
        ) : balanceError ? (
          <p className="text-sm text-warn">Could not load your payout. Refresh and try again.</p>
        ) : balance > 0n ? (
          <div className="space-y-2">
            <p className="text-sm">
              You’re checked in. Your event payout was <b>{formatUsdc(event.payout_per_attendee)} USDC</b>. Available across all your events: <b>{formatUsdc(balance)} USDC</b>.
            </p>
            <CashOut accountId={accountId} kind={kind} balance={balance} onDone={loadBalance} startOpen />
          </div>
        ) : (
          <p className="text-sm">
            Your event payout was <b>{formatUsdc(event.payout_per_attendee)} USDC</b>. No funds are currently available in your Nearvent balance. <Link href="/me" className="text-accent underline">View funds</Link>
          </p>
        )
      ) : myStatus === "Registered" ? (
        <p className="text-sm">You weren’t checked in, so your deposit went to the people who came.</p>
      ) : balanceLoading ? (
        <p className="text-sm text-muted">Checking your Nearvent balance…</p>
      ) : balanceError ? (
        <p className="text-sm text-warn">Could not load your Nearvent balance. Refresh and try again.</p>
      ) : balance > 0n ? (
        <div className="space-y-2">
          <p className="text-sm">
            You have <b>{formatUsdc(balance)} USDC</b> in your Nearvent balance. This is an account-level balance and may include funds from other events.
          </p>
          <CashOut accountId={accountId} kind={kind} balance={balance} onDone={loadBalance} startOpen />
        </div>
      ) : (
        <p className="text-sm">This event is over and the pool was paid out.</p>
      );
  } else if (myStatus === "Attended") {
    body = (
      <div>
        <p className="font-semibold text-good">✓ You’re checked in</p>
        {!ticket && <p className="text-sm text-muted mt-1">Your payout arrives when the event is settled.</p>}
      </div>
    );
  } else if (myStatus === "Registered") {
    body = <NextSteps event={event} accountId={accountId!} />;
  } else if (Date.now() >= registrationEndsAt(event)) {
    // The escrow refuses registrations once the event has ended (Deposit events: once it has started).
    body = accountId
      ? <p className="text-sm">Registration is closed: the event has {Date.now() >= event.metadata.ends_at ? "ended" : "started"}.</p>
      : <SignInFolded hint="Registration is closed. Registered? Sign in to see your pass." onDone={refreshAfterSignIn} />;
  } else if (needsBond(event)) {
    body = accountId === event.host
      ? <p className="text-sm text-muted">Registration opens once you lock your bond below.</p>
      : <p className="text-sm text-muted">Registration opens once the host locks a bond of {formatUsdc(hostBondFor(event))} USDC.</p>;
  } else if (accountId === event.host) {
    body = <p className="text-sm">You’re the host. Hosts can’t take a seat at their own event.</p>;
  } else if (accountId && rule && access?.allowed === false) {
    body = (
      <p className="text-sm">
        You can’t register yet. {ruleText(rule)} You came to {access.attended}{access.no_shows ? ` and skipped ${access.no_shows}` : ""}.
      </p>
    );
  } else if (accountId && rule && !access) {
    body = <p className="text-sm text-muted">Checking whether you can register…</p>;
  } else if (event.guest_count >= event.capacity) {
    body = accountId ? <p className="text-sm">This event is full.</p> : choosing ? (
      <div className="space-y-2">
        <div className="text-sm font-medium">How do you want to sign in?</div>
        <SignInOptions onDone={refreshAfterSignIn} />
        <button className="w-full text-xs text-muted pt-1" onClick={() => setChoosing(false)}>Back</button>
      </div>
    ) : (
      <button className="btn btn-accent w-full !py-3.5" onClick={() => setChoosing(true)}>Sign In to View Your Pass</button>
    );
  } else {
    // One tap pays and registers: balance, NEAR Intents, any wallet token (components/OneTapCheckout.tsx).
    body = <OneTapCheckout event={event} onRegistered={onChange} />;
  }

  const open = registrationOpen(event) && !myStatus && event.guest_count < event.capacity;
  return (
    <div className="space-y-3">
      {open && rule && access?.allowed !== false && <p className="text-sm text-muted">{ruleText(rule)}</p>}
      {body}
      {error && (
          <p className="text-sm text-warn break-words">
            {error} {accountId && <Link href="/me" className="underline">View your funds</Link>}
          </p>
        )}
      {open && (
        <div className="space-y-1.5 text-sm text-muted leading-relaxed">
          {explain && <p>{ticket ? "A paid ticket. The money goes to the host when you register; tickets are not refunded." : event.dao ? `Get checked in to get your deposit back plus a share of the no-shows, paid when the ${windowText(event)} dispute window ends. Miss it and your deposit goes to the guests who came. Marked absent by mistake? You can dispute it.` : "Get checked in to get your deposit back plus a share of the no-shows when the host publishes who came. Miss it and your deposit goes to the guests who came."}</p>}
          <DepositRulesTooltip
            ticket={ticket}
            amount={price}
            oracle={!!event.dao}
            disputeWindow={windowText(event)}
            submit={hoursText(event.rules?.submit_hours ?? 72)}
            resolve={hoursText(event.rules?.resolve_hours ?? 168)}
            perSeat={event.rules?.bond_per_seat ? bondPerSeatText(event) : undefined}
            closesAtStart={registrationEndsAt(event) === event.metadata.starts_at}
          />
        </div>
      )}
    </div>
  );
}

/** Visitors who only browse see one quiet button; the wallet choices open on tap. */
function SignInFolded({ hint, onDone }: { hint: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{hint}</p>
      {open ? <SignInOptions onDone={onDone} /> : <button type="button" className="btn btn-ghost w-full" onClick={() => setOpen(true)}>Sign In</button>}
    </div>
  );
}
