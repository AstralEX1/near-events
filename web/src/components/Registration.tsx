"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus, isTicket } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, TEST_EVM_FAUCET_LIMIT, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { confirmRegistration, intentsUsdcBalance, registerFromIntents } from "@/lib/intents";
import { NextSteps } from "@/components/EventParts";
import { CashOut } from "@/components/CashOut";
import { DepositRulesTooltip } from "@/components/DepositRulesTooltip";
import { guestNamesApi } from "@/lib/guestNamesClient";

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
}: {
  event: EventView;
  myStatus: GuestStatus | null;
  onChange: () => Promise<void>;
  embedReturnTo?: string;
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
      await registerFromIntents(accountId!, event.id, event.deposit);
      await confirmRegistration(event.id, accountId!).catch(() => {
        throw new Error("Registration is not confirmed. Check your event and NEAR Intents balance before paying again.");
      });
      await saveName(name).catch(() => {});
    });

  const price = `${formatUsdc(event.deposit)} USDC`;
  const ticket = isTicket(event);
  const action = ticket ? "Get ticket" : "Register";
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled" && ticket) {
    body = <p className="text-sm">This event was cancelled. Tickets are not refunded.</p>;
  } else if (event.status === "Cancelled") {
    body = (
      <div className="space-y-2">
        <p className="text-sm">This event was cancelled. Refunds were credited to guests’ Nearvent balances.</p>
        {!accountId ? (
          <div className="space-y-2">
            <p className="text-sm text-muted">Sign in to view your refund.</p>
            <SignInOptions onDone={refreshAfterSignIn} />
          </div>
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
      <div className="space-y-2">
        <p className="text-sm">Sign in to view your payout or deposit outcome.</p>
        <SignInOptions onDone={refreshAfterSignIn} />
      </div>
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

  const open = event.status === "Open" && !myStatus && event.guest_count < event.capacity;
  return (
    <div className="space-y-3">
      {body}
      {error && (
          <p className="text-sm text-warn break-words">
            {error} {accountId && <Link href="/me" className="underline">View your funds</Link>}
          </p>
        )}
      {open && (
        <div className="space-y-1.5 text-sm text-muted leading-relaxed">
          <p>{ticket ? "A paid ticket. The money goes to the host when you register; tickets are not refunded." : "Get checked in and receive your deposit plus a share of no-shows after the host closes the event. Miss it, and your deposit goes to the guests who came."}</p>
          <DepositRulesTooltip ticket={ticket} amount={price} />
        </div>
      )}
    </div>
  );
}
