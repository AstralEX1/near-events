"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, ONECLICK_REGISTERS, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { intentsUsdcBalance, registerFromIntents } from "@/lib/intents";
import { NextSteps, RulesBox } from "@/components/EventParts";
import { CashOut } from "@/components/CashOut";
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
  const router = useRouter();
  const [intentsBalance, setIntentsBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [choosing, setChoosing] = useState(false);
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
  // with a register message, so the swap registers the guest. No USDC on NEAR
  // → the pay page takes any token from any chain.
  const registerViaOneClick = async () => {
    setStage("Getting a NEAR Intents quote…");
    const quote = await registerQuote({ originAsset: USDC_ASSET, eventId: event.id, deposit: event.deposit, guest: accountId!, refundTo: accountId! });
    if (!quote.depositAddress) throw new Error("NEAR Intents returned no deposit address. Try again.");
    const have = BigInt(await usdc.balance(accountId!).catch(() => "0"));
    if (have < BigInt(quote.amountIn)) {
      router.push(`/e/${event.id}/pay`);
      return;
    }
    setStage("Confirm in your wallet…");
    await send(payDepositAddress(USDC_CONTRACT, quote.depositAddress, quote.amountIn));
    setStage("NEAR Intents is delivering your deposit…");
    await waitForSwap(quote.depositAddress, (s) => setStage(`NEAR Intents: ${s.toLowerCase().replaceAll("_", " ")}…`));
  };

  // Testnet: Tidepool can't register in the swap (see ONECLICK_REGISTERS), so
  // the test USDC from the Tidepool faucet goes straight to the escrow.
  // Payouts still leave through NEAR Intents.
  const registerDirect = async () => {
    const deposit = BigInt(event.deposit);
    if (BigInt(await usdc.balance(accountId!).catch(() => "0")) < deposit) {
      if (!HAS_FAUCET) throw new Error(`You need ${formatUsdc(deposit)} USDC on NEAR.`);
      setStage("Getting test USDC…");
      const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Faucet failed");
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
  };

  const register = () => run(ONECLICK_REGISTERS ? registerViaOneClick : registerDirect);

  useEffect(() => {
    if (kind === "evm" && accountId) intentsUsdcBalance(accountId).then(setIntentsBalance).catch(() => setIntentsBalance(0n));
  }, [kind, accountId]);

  const registerViaIntents = () => run(() => registerFromIntents(accountId!, event.id, event.deposit));

  const price = `${formatUsdc(event.deposit)} USDC`;
  // One primary button per state; alternatives stay folded away.
  let body;
  if (event.status === "Cancelled") {
    body = (
      <div className="space-y-2">
        <p className="text-sm">This event was cancelled. Every deposit went back to its guest.</p>
        {balance > 0n && <CashOut accountId={accountId!} kind={kind} balance={balance} onDone={loadBalance} startOpen />}
      </div>
    );
  } else if (event.status === "Finalized") {
    body =
      myStatus === "Attended" ? (
        balance > 0n ? (
          <div className="space-y-2">
            <p className="text-sm">
              You showed up. {event.attended_count} of {event.guest_count} came. You have <b>{formatUsdc(balance)} USDC</b>.
            </p>
            <CashOut accountId={accountId!} kind={kind} balance={balance} onDone={loadBalance} startOpen />
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
          {busy ? stage ?? "Working…" : `Register · ${price}`}
        </button>
        <p className="text-xs text-muted text-center">
          {ONECLICK_REGISTERS ? "Paid through NEAR Intents. No USDC on NEAR? You can pay with any token from any chain." : "Testnet: free test USDC. Payouts go out through NEAR Intents."}
        </p>
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
