"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { Avatar, shortAccount } from "@/components/ui";
import { SignInOptions } from "@/components/SignIn";
import { intentsUsdcBalance, registerFromIntents } from "@/lib/intents";

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

  useEffect(() => {
    if (accountId) events.balance(accountId).then((b) => setBalance(BigInt(b))).catch(() => {});
  }, [accountId]);

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
    }
  };

  const register = () =>
    run(async () => {
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

  const registerWithBalance = () =>
    run(() => send([{ receiverId: EVENTS_CONTRACT, methodName: "register_with_balance", args: { event_id: event.id } }]));

  let body;
  if (event.status === "Cancelled") {
    body = <p>This event was cancelled. Every deposit was returned to the guests’ balances.</p>;
  } else if (event.status === "Finalized") {
    body =
      myStatus === "Attended" ? (
        <p>
          You showed up and earned <b>{formatUsdc(event.payout_per_attendee)} USDC</b>.{" "}
          <Link href="/me" className="text-accent font-medium">Withdraw →</Link>
        </p>
      ) : myStatus === "Registered" ? (
        <p>You weren’t checked in, so your deposit went to the people who came.</p>
      ) : (
        <p>This event has ended and the pool was paid out.</p>
      );
  } else if (myStatus === "Attended") {
    body = <p className="font-medium text-good">✓ You’re checked in. Your share arrives when the host closes the event.</p>;
  } else if (myStatus === "Registered") {
    body = (
      <div className="flex items-center gap-3">
        <Avatar account={accountId!} size={40} />
        <div>
          <div className="font-semibold">You’re going</div>
          <div className="text-sm text-muted">Show your account <b>{shortAccount(accountId!)}</b> to the host at the door.</div>
        </div>
      </div>
    );
  } else if (event.guest_count >= event.capacity) {
    body = <p>This event is full.</p>;
  } else if (!accountId) {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">Welcome! Sign in to register. No wallet needed.</p>
        <SignInOptions />
      </div>
    );
  } else if (kind === "evm") {
    const enough = intentsBalance !== null && intentsBalance >= BigInt(event.deposit);
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Your NEAR Intents balance: <b className="text-text">{intentsBalance === null ? "…" : formatUsdc(intentsBalance)} USDC</b>.
          One signature in your wallet moves {formatUsdc(event.deposit)} USDC into the escrow. No gas.
        </p>
        {enough ? (
          <button className="btn btn-primary w-full" disabled={busy} onClick={registerViaIntents}>
            {busy ? "Sign in your wallet…" : `Register from Intents · ${formatUsdc(event.deposit)} USDC`}
          </button>
        ) : (
          <Link href={`/e/${event.id}/pay`} className="btn btn-primary w-full">Pay from any chain or token</Link>
        )}
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Put down <b className="text-text">{formatUsdc(event.deposit)} USDC</b>. Show up and you get it back plus a share of
          the no-shows’ deposits.
        </p>
        <button className="btn btn-primary w-full" disabled={busy} onClick={register}>
          {busy ? "Confirm in your wallet…" : `Register · ${formatUsdc(event.deposit)} USDC`}
        </button>
        {balance >= BigInt(event.deposit) && (
          <button className="btn btn-ghost w-full" disabled={busy} onClick={registerWithBalance}>
            Use my Near Events balance ({formatUsdc(balance)} USDC)
          </button>
        )}
        <Link href={`/e/${event.id}/pay`} className="btn btn-ghost w-full">Pay from any chain or token</Link>
        {HAS_FAUCET && <p className="text-xs text-muted">Testnet: missing test USDC is minted for you in the same step.</p>}
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 text-sm font-medium border-b border-border bg-bg/50">Registration</div>
      <div className="p-4">
        {body}
        {error && <p className="text-sm text-warn mt-3 break-words">{error}</p>}
      </div>
    </div>
  );
}
