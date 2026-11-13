"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, hostBondFor, needsBond, registrationEndsAt, usdc, type EventView, type GuestStatus, isTicket } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, TEST_EVM_FAUCET_LIMIT, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { confirmRegistration, intentsUsdcBalance, registerFromIntents } from "@/lib/intents";
import { NextSteps } from "@/components/EventParts";
import { CashOut } from "@/components/CashOut";
import { DepositRulesTooltip } from "@/components/DepositRulesTooltip";
import { guestNamesApi } from "@/lib/guestNamesClient";
import { ruleText, type AccessCheck } from "@/lib/access";

function requireDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter your name so the host can find you at the door.");
  if (new TextEncoder().encode(name).length > 80) throw new Error("Name is too long. Shorten it and try again.");
  return name;
}

/** Sign in, then put down the deposit. Used on the event page and in the embed popup. */
export function RegistrationCard({
  event,
  myStatus,
  onChange,
  embedReturnTo,
  explain = true,
}: {
  event: EventView;
  myStatus: GuestStatus | null;
  onChange: () => Promise<void>;
  embedReturnTo?: string;
  /** The event page shows a one-line summary above instead of the long rule text. */
  explain?: boolean;
}) {
  const { accountId, kind, send, staffToken } = useWallet();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [intentsBalance, setIntentsBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceState, setBalanceState] = useState<"loading" | "ready" | "error">("loading");
  const [balanceAccountId, setBalanceAccountId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  // The escrow's verdict under the event's access rule; it refunds a refused registration.
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const paymentUrl = `/e/${event.id}/pay${embedReturnTo ? `?returnTo=${encodeURIComponent(embedReturnTo)}` : ""}`;
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

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const saveName = async (name: string) => {
    setStage("Saving your name…");
    const token = await staffToken();
    await guestNamesApi.save(event.id, name, token);
  };

  const registerDirect = async () => {
    const name = requireDisplayName(displayName);
    const deposit = BigInt(event.deposit);
    if (BigInt(await usdc.balance(accountId!).catch(() => "0")) < deposit) {
      if (!HAS_FAUCET) {
        router.push(paymentUrl);
        return;
      }
      setStage("Getting USDC…");
      const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not get USDC");
      if (BigInt(await usdc.balance(accountId!)) < deposit) throw new Error("Not enough USDC for this price.");
    }
    setStage("Confirm in your wallet…");
    await send([
      {
        receiverId: USDC_CONTRACT,
        methodName: "ft_transfer_call",
        args: { receiver_id: EVENTS_CONTRACT, amount: event.deposit, msg: JSON.stringify({ action: "register", event_id: event.id }) },
        deposit: 1n,
      },
    ]);
    await confirmRegistration(event.id, accountId!);
    await saveName(name).catch(() => {
      // Registration already landed on-chain; name is best-effort for the host list.
    });
  };

  const register = () => run(registerDirect);

  useEffect(() => {
    if (kind === "evm" && accountId) intentsUsdcBalance(accountId).then(setIntentsBalance).catch(() => setIntentsBalance(0n));
  }, [kind, accountId]);

  // EVM wallets pay from their NEAR Intents balance. On testnet an empty
  // balance gets free test USDC first (the relayer deposits it into Intents).
  const registerViaIntents = () =>
    run(async () => {
      const name = requireDisplayName(displayName);
      let available = await intentsUsdcBalance(accountId!);
      if (available < BigInt(event.deposit) && !HAS_FAUCET) {
        router.push(paymentUrl);
        return;
      }
      if (available < BigInt(event.deposit)) {
        if (BigInt(event.deposit) > TEST_EVM_FAUCET_LIMIT) {
          throw new Error(`You need ${formatUsdc(event.deposit)} USDC in Intents to register.`);
        }
        setStage("Getting USDC into NEAR Intents…");
        const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
        if (!r.ok) throw new Error((await r.json()).error ?? "Could not get USDC");
        available = await intentsUsdcBalance(accountId!);
        if (available < BigInt(event.deposit)) {
          throw new Error(`You need ${formatUsdc(event.deposit)} USDC in Intents to register.`);
        }
      }
      setStage("Sign in your wallet…");
      await registerFromIntents(accountId!, event.id, event.deposit, name);
      await confirmRegistration(event.id, accountId!).catch(() => {
        throw new Error("Registration is not confirmed. Check your event and NEAR Intents balance before paying again.");
      });
    });

  const price = `${formatUsdc(event.deposit)} USDC`;
  const ticket = isTicket(event);
  const action = ticket ? "Get ticket" : "Register";
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled" && ticket) {
    body = <p className="text-sm">This event was cancelled. Tickets are not refunded.</p>;
  } else if (event.status === "Submitted") {
    body = myStatus ? (
      <p className="text-sm">The host published who came. Payouts follow the 24-hour dispute window; see below.</p>
    ) : (
      <p className="text-sm">This event is over. The host published who came; payouts follow the dispute window.</p>
    );
  } else if (event.status === "Cancelled" || event.status === "Refunded") {
    body = (
      <div className="space-y-2">
        <p className="text-sm">
          {event.status === "Refunded"
            ? "The host did not publish who came in time, so every deposit was refunded with a share of the host bond."
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
        {!ticket && <p className="text-sm text-muted mt-1">Withdraw your payout here once the host closes the event.</p>}
      </div>
    );
  } else if (myStatus === "Registered") {
    body = <NextSteps event={event} accountId={accountId!} />;
  } else if (Date.now() >= registrationEndsAt(event)) {
    // The escrow refuses registrations once the event has ended (Deposit events: once it has started).
    body = accountId
      ? <p className="text-sm">Registration is closed: the event has {Date.now() >= event.metadata.ends_at ? "ended" : "started"}.</p>
      : <SignInFolded hint="Registration is closed. Registered? Sign in to see your pass." onDone={refreshAfterSignIn} />;
  } else if (accountId === event.host) {
    body = <p className="text-sm">You’re the host. Hosts can’t take a seat at their own event.</p>;
  } else if (needsBond(event)) {
    body = <p className="text-sm text-muted">Registration opens once the host locks a {formatUsdc(hostBondFor(event))} USDC bond.</p>;
  } else if (accountId && rule && access?.allowed === false) {
    body = (
      <p className="text-sm">
        You can’t register yet. {ruleText(rule)} You came to {access.attended}{access.no_shows ? ` and skipped ${access.no_shows}` : ""}.
      </p>
    );
  } else if (accountId && rule && !access) {
    body = <p className="text-sm text-muted">Checking whether you can register…</p>;
  } else if (!accountId) {
    body = choosing ? (
      <div className="space-y-2">
        <div className="text-sm font-medium">How do you want to sign in?</div>
        <SignInOptions onDone={refreshAfterSignIn} />
        <button className="w-full text-xs text-muted pt-1" onClick={() => setChoosing(false)}>Back</button>
      </div>
    ) : (
      <button className="btn btn-accent w-full !py-3.5" onClick={() => setChoosing(true)}>
        {event.guest_count >= event.capacity ? "Sign in to view your pass" : `${action} · ${price}`}
      </button>
    );
  } else if (event.guest_count >= event.capacity) {
    body = <p className="text-sm">This event is full.</p>;
  } else if (kind === "evm") {
    const enough = HAS_FAUCET || (intentsBalance !== null && intentsBalance >= BigInt(event.deposit));
    body = (
      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your name</span>
          <input
            className="input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name for the guest list"
            autoComplete="name"
            maxLength={80}
            disabled={busy}
          />
        </label>
        {enough ? (
          <button className="btn btn-accent w-full" disabled={busy} onClick={registerViaIntents}>
            {busy ? stage ?? "Sign in your wallet…" : `${action} · ${price}`}
          </button>
        ) : (
          <Link href={paymentUrl} className="btn btn-accent w-full">{action} · {price}</Link>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your name</span>
          <input
            className="input w-full"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name for the guest list"
            autoComplete="name"
            maxLength={80}
            disabled={busy}
          />
        </label>
        <button className="btn btn-accent w-full !py-3.5" disabled={busy} onClick={register}>
          {busy ? stage ?? "Working…" : `${action} · ${price}`}
        </button>
        <p className="text-xs text-muted text-center">
          Paid through NEAR Intents. No USDC on NEAR? You can use a supported token and network.
        </p>
      </div>
    );
  }

  const open = event.status === "Open" && !myStatus && event.guest_count < event.capacity && Date.now() < registrationEndsAt(event) && !needsBond(event);
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
          {explain && <p>{ticket ? "A paid ticket. The money goes to the host when you register; tickets are not refunded." : "Get checked in and receive your deposit plus a share of no-shows once the host’s list has stood for 12 hours. Miss it, and your deposit goes to the guests who came. Marked absent by mistake? Dispute it."}</p>}
          <DepositRulesTooltip ticket={ticket} amount={price} oracle={!!event.dao} />
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
