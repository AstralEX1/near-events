"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus, isTicket } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, LIVE_EVENT_SWAPS, TEST_EVM_FAUCET_LIMIT, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { confirmRegistration, intentsUsdcBalance, registerFromIntents } from "@/lib/intents";
import { NextSteps, RulesBox } from "@/components/EventParts";
import { CashOut } from "@/components/CashOut";

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
  const { accountId, kind, send } = useWallet();
  const router = useRouter();
  const [intentsBalance, setIntentsBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [balanceState, setBalanceState] = useState<"loading" | "ready" | "error">("loading");
  const [balanceAccountId, setBalanceAccountId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [rules, setRules] = useState(false);
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

  const registerDirect = async () => {
    const deposit = BigInt(event.deposit);
    if (BigInt(await usdc.balance(accountId!).catch(() => "0")) < deposit) {
      if (!HAS_FAUCET) {
        router.push(paymentUrl);
        return;
      }
      setStage("Getting test USDC…");
      const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Faucet failed");
      if (BigInt(await usdc.balance(accountId!)) < deposit) throw new Error("The test faucet did not cover this price.");
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
  };

  const register = () => run(registerDirect);

  useEffect(() => {
    if (kind === "evm" && accountId) intentsUsdcBalance(accountId).then(setIntentsBalance).catch(() => setIntentsBalance(0n));
  }, [kind, accountId]);

  // EVM wallets pay from their NEAR Intents balance. On testnet an empty
  // balance gets free test USDC first (the relayer deposits it into Intents).
  const registerViaIntents = () =>
    run(async () => {
      let available = await intentsUsdcBalance(accountId!);
      if (available < BigInt(event.deposit) && !HAS_FAUCET) {
        router.push(paymentUrl);
        return;
      }
      if (available < BigInt(event.deposit)) {
        if (BigInt(event.deposit) > TEST_EVM_FAUCET_LIMIT) {
          throw new Error(`The test faucet tops up to ${formatUsdc(TEST_EVM_FAUCET_LIMIT)} USDC. You need ${formatUsdc(event.deposit)} USDC in Intents to register.`);
        }
        setStage("Getting test USDC into NEAR Intents…");
        const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
        if (!r.ok) throw new Error((await r.json()).error ?? "Faucet failed");
        available = await intentsUsdcBalance(accountId!);
        if (available < BigInt(event.deposit)) {
          throw new Error(`The test faucet tops up to ${formatUsdc(TEST_EVM_FAUCET_LIMIT)} USDC. You need ${formatUsdc(event.deposit)} USDC in Intents to register.`);
        }
      }
      setStage("Sign in your wallet…");
      await registerFromIntents(accountId!, event.id, event.deposit);
      await confirmRegistration(event.id, accountId!).catch(() => {
        throw new Error("Registration is not confirmed. Check your event and NEAR Intents balance before paying again.");
      });
    });

  const price = `${formatUsdc(event.deposit)} USDC`;
  const ticket = isTicket(event);
  const action = ticket ? "Get ticket" : "Register";
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled") {
    body = (
      <div className="space-y-2">
        <p className="text-sm">This event was cancelled. {ticket ? "Every ticket was refunded." : "Every deposit went back to its guest."}</p>
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
        <p className="text-sm">Nobody was checked in. Your deposit was credited to Near Me.</p>
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
              You showed up. {event.attended_count} of {event.guest_count} came. You have <b>{formatUsdc(balance)} USDC</b>.
            </p>
            <CashOut accountId={accountId} kind={kind} balance={balance} onDone={loadBalance} startOpen />
          </div>
        ) : (
          <p className="text-sm">
            You showed up and got <b>{formatUsdc(event.payout_per_attendee)} USDC</b>. ✓ Withdrawn.
          </p>
        )
      ) : myStatus === "Registered" ? (
        <p className="text-sm">You weren’t checked in, so your deposit went to the people who came.</p>
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
    body = enough ? (
      <button className="btn btn-accent w-full" disabled={busy} onClick={registerViaIntents}>
        {busy ? stage ?? "Sign in your wallet…" : `${action} · ${price}`}
      </button>
    ) : (
      <Link href={paymentUrl} className="btn btn-accent w-full">{action} · {price}</Link>
    );
  } else {
    body = (
      <div className="space-y-2">
        <button className="btn btn-accent w-full !py-3.5" disabled={busy} onClick={register}>
          {busy ? stage ?? "Working…" : `${action} · ${price}`}
        </button>
        <p className="text-xs text-muted text-center">
          {LIVE_EVENT_SWAPS ? "Paid through NEAR Intents. No USDC on NEAR? You can pay with any token from any chain." : "Testnet: free test USDC. Payouts go out through NEAR Intents."}
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
        <p className="text-sm text-muted leading-relaxed">
          {ticket ? "Refunded if the host cancels." : "Come and get it back plus a share of the no-shows. No cancelling."}{" "}
          <button className="text-accent" onClick={() => setRules(!rules)}>{rules ? "Hide" : "How it works"}</button>
        </p>
      )}
      {open && rules && <RulesBox event={event} />}
    </div>
  );
}
