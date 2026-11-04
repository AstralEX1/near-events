"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, HAS_INTENTS, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { intentsUsdcBalance, pushPayoutToIntents, registerFromIntents } from "@/lib/intents";
import { NextSteps, RulesBox } from "@/components/EventParts";
import { payDepositAddress, registerQuote, USDC_ASSET, waitForSwap } from "@/lib/oneclickClient";

/** Sign in, then put down the deposit. Used on the event page and in the embed popup. */
export function RegistrationCard({
  event,
  myStatus,
  onChange,
}: {
  event: EventView;
  myStatus: GuestStatus | null;
  onChange: () => Promise<void>;
}) {
  const { accountId, kind, send } = useWallet();
  const [intentsBalance, setIntentsBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [choosing, setChoosing] = useState(false);
  const [more, setMore] = useState(false);
  const [rules, setRules] = useState(false);
  const [stage, setStage] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    if (accountId) setBalance(BigInt(await events.balance(accountId).catch(() => "0")));
  }, [accountId]);

  useEffect(() => {
    loadBalance();
  }, [loadBalance]);

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

  // Mainnet: the deposit goes through NEAR Intents (1Click). The wallet pays a
  // 1Click address in USDC; 1Click delivers exactly the deposit to the escrow
  // with a register message, so the swap itself registers the guest.
  const registerViaOneClick = async () => {
    const deposit = BigInt(event.deposit);
    setStage("Getting a NEAR Intents quote…");
    const quote = await registerQuote({ originAsset: USDC_ASSET, eventId: event.id, deposit: event.deposit, guest: accountId!, refundTo: accountId! });
    if (!quote.depositAddress) throw new Error("NEAR Intents returned no deposit address. Try again.");
    const have = BigInt(await usdc.balance(accountId!).catch(() => "0"));
    if (have < BigInt(quote.amountIn))
      throw new Error(`You need ${formatUsdc(quote.amountIn)} USDC on NEAR (${formatUsdc(deposit)} deposit + NEAR Intents fee). Use “Pay with any token, any chain”.`);
    setStage("Confirm in your wallet…");
    await send(payDepositAddress(USDC_CONTRACT, quote.depositAddress, quote.amountIn));
    setStage("NEAR Intents is delivering your deposit…");
    await waitForSwap(quote.depositAddress, (s) => setStage(`NEAR Intents: ${s.toLowerCase().replaceAll("_", " ")}…`));
  };

  const register = () =>
    run(async () => {
      if (HAS_INTENTS) return registerViaOneClick();
      // Testnet only: NEAR Intents doesn't exist there, so the deposit goes
      // straight to the escrow.
      const deposit = BigInt(event.deposit);
      const calls: Call[] = [];
      const have = BigInt(await usdc.balance(accountId!));
      if (have < deposit) {
        if (!HAS_FAUCET) throw new Error(`You need ${formatUsdc(deposit)} USDC on NEAR. Use “Pay from any chain”.`);
        // Testnet: our faucet mints the missing test USDC, no extra signature needed.
        const r = await fetch("/api/faucet", {
          method: "POST",
          body: JSON.stringify({ accountId, amount: (deposit - have).toString() }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Faucet failed");
      }
      calls.push({
        receiverId: USDC_CONTRACT,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: EVENTS_CONTRACT,
          amount: event.deposit,
          msg: JSON.stringify({ action: "register", event_id: event.id }),
        },
        deposit: 1n,
      });
      await send(calls);
    });

  useEffect(() => {
    if (kind === "evm" && accountId) intentsUsdcBalance(accountId).then(setIntentsBalance).catch(() => setIntentsBalance(0n));
  }, [kind, accountId]);

  const registerViaIntents = () => run(() => registerFromIntents(accountId!, event.id, event.deposit));

  // Payouts land in the contract balance; this sends all of it out. On mainnet
  // it goes to the guest's NEAR Intents balance (cash out to any chain from
  // /me). EVM sign-ins can't call the contract, so the relayer pushes theirs.
  const withdrawAll = () =>
    run(async () => {
      if (kind === "evm") await pushPayoutToIntents(accountId!);
      else
        await send([
          {
            receiverId: EVENTS_CONTRACT,
            methodName: "withdraw",
            args: { amount: null, receiver_id: null, to_intents: HAS_INTENTS },
            deposit: 1n,
            gas: 200_000_000_000_000n,
          },
        ]);
      await loadBalance();
    });

  const registerWithBalance = () =>
    run(() =>
      send([{ receiverId: EVENTS_CONTRACT, methodName: "register_with_balance", args: { event_id: event.id }, deposit: 1n }]),
    );

  const price = `${formatUsdc(event.deposit)} USDC`;
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled") {
    body = <p className="text-sm">This event was cancelled. Every deposit went back to its guest.</p>;
  } else if (event.status === "Finalized") {
    body =
      myStatus === "Attended" ? (
        balance > 0n ? (
          <div className="space-y-2">
            <button className="btn btn-good w-full !py-3.5" disabled={busy} onClick={withdrawAll}>
              {busy ? "Confirm in your wallet…" : HAS_INTENTS ? `Withdraw ${formatUsdc(balance)} USDC to NEAR Intents` : `Withdraw ${formatUsdc(balance)} USDC`}
            </button>
            <p className="text-sm text-muted">
              You showed up. {event.attended_count} of {event.guest_count} came.{" "}
              <Link href="/me" className="text-accent">{HAS_INTENTS ? "Cash out to any chain" : "Other ways to withdraw"}</Link>
            </p>
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
        <p className="text-sm text-muted mt-1">Withdraw your payout here once the host closes the event.</p>
      </div>
    );
  } else if (myStatus === "Registered") {
    body = <NextSteps event={event} accountId={accountId!} />;
  } else if (event.guest_count >= event.capacity) {
    body = <p className="text-sm">This event is full.</p>;
  } else if (!accountId) {
    body = choosing ? (
      <div className="space-y-2">
        <div className="text-sm font-medium">How do you want to sign in?</div>
        <SignInOptions />
        <button className="w-full text-xs text-muted pt-1" onClick={() => setChoosing(false)}>Back</button>
      </div>
    ) : (
      <button className="btn btn-accent w-full !py-3.5" onClick={() => setChoosing(true)}>Register · {price}</button>
    );
  } else if (kind === "evm") {
    const enough = intentsBalance !== null && intentsBalance >= BigInt(event.deposit);
    body = enough ? (
      <button className="btn btn-accent w-full" disabled={busy} onClick={registerViaIntents}>
        {busy ? "Sign in your wallet…" : `Register · ${price}`}
      </button>
    ) : (
      <Link href={`/e/${event.id}/pay`} className="btn btn-accent w-full">Register · {price}</Link>
    );
  } else {
    body = (
      <div className="space-y-2">
        <button className="btn btn-accent w-full !py-3.5" disabled={busy} onClick={register}>
          {busy ? stage ?? "Confirm in your wallet…" : `Register · ${price}`}
        </button>
        {HAS_INTENTS && <p className="text-xs text-muted text-center">Paid in USDC through NEAR Intents</p>}
        {more ? (
          <div className="space-y-2">
            {balance >= BigInt(event.deposit) && (
              <button className="btn btn-ghost w-full text-sm" disabled={busy} onClick={registerWithBalance}>
                Use my balance ({formatUsdc(balance)} USDC)
              </button>
            )}
            <Link href={`/e/${event.id}/pay`} className="btn btn-ghost w-full text-sm">Pay with any token, any chain</Link>
          </div>
        ) : (
          <button className="w-full text-xs text-muted hover:text-text" onClick={() => setMore(true)}>Other ways to pay</button>
        )}
      </div>
    );
  }

  const open = event.status === "Open" && !myStatus && event.guest_count < event.capacity;
  return (
    <div className="space-y-3">
      {body}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      {open && (
        <p className="text-sm text-muted leading-relaxed">
          Come and get it back plus a share of the no-shows. No cancelling.{" "}
          <button className="text-accent" onClick={() => setRules(!rules)}>{rules ? "Hide" : "How it works"}</button>
        </p>
      )}
      {open && rules && <RulesBox event={event} />}
    </div>
  );
}
