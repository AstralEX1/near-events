"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, usdc, type EventView, type GuestStatus, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, USDC_CONTRACT } from "@/lib/config";
import { useWallet, type Call } from "@/lib/wallet";
import { Avatar, AvatarStack, Cover, DateBadge, StatusPill, formatWhen, shortAccount } from "@/components/ui";
import { SignInOptions } from "@/components/SignIn";

export default function EventPage() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [guests, setGuests] = useState<GuestView[]>([]);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([events.get(id), events.guests(id).catch(() => [])]);
    setEvent(e);
    setGuests(g);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (event === undefined) return <p className="text-muted">Loading…</p>;
  if (event === null) return <p>Event not found.</p>;

  const me = guests.find((g) => g.account_id === accountId);
  const isStaff = !!accountId && (accountId === event.host || event.cohosts.includes(accountId));
  const attendees = guests.filter((g) => g.status === "Attended");

  return (
    <div className="grid gap-8 md:grid-cols-[340px_1fr]">
      <aside className="space-y-6">
        <Cover event={event} className="aspect-square w-full rounded-2xl" />
        <div>
          <div className="label mb-2">Hosted by</div>
          <div className="space-y-2">
            {[event.host, ...event.cohosts].map((a, i) => (
              <div key={a} className="flex items-center gap-2 text-sm">
                <Avatar account={a} size={26} />
                <span className="truncate">{shortAccount(a)}</span>
                {i === 0 && a.includes("sputnik") && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent">DAO</span>
                )}
                {i > 0 && <span className="text-xs text-muted">co-host</span>}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-2">
            {event.guest_count} going{event.attended_count > 0 && ` · ${event.attended_count} checked in`}
          </div>
          <AvatarStack accounts={guests.map((g) => g.account_id)} max={8} />
        </div>
        {isStaff && (
          <Link href={`/e/${id}/manage`} className="btn btn-ghost w-full">Manage & check in guests</Link>
        )}
      </aside>

      <section className="space-y-6">
        <div>
          <StatusPill status={event.status} />
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-3">{event.metadata.title}</h1>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <DateBadge ms={event.metadata.starts_at} />
            <div className="text-sm">
              <div className="font-medium">{formatWhen(event.metadata.starts_at, event.metadata.ends_at)}</div>
              <div className="text-muted">{Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg border border-border bg-surface flex items-center justify-center text-lg">📍</div>
            <div className="text-sm font-medium">{event.metadata.location || "Location TBA"}</div>
          </div>
        </div>

        <RegistrationCard event={event} myStatus={me?.status ?? null} onChange={load} />

        <PoolStats event={event} />

        {event.metadata.description && (
          <div>
            <div className="label mb-2 pb-2 border-b border-border">About event</div>
            <p className="whitespace-pre-wrap leading-relaxed">{event.metadata.description}</p>
          </div>
        )}

        {event.status === "Finalized" && attendees.length > 0 && (
          <div>
            <div className="label mb-2 pb-2 border-b border-border">Showed up and got paid</div>
            <div className="flex flex-wrap gap-2">
              {attendees.map((g) => (
                <span key={g.account_id} className="flex items-center gap-1.5 text-sm card px-2 py-1">
                  <Avatar account={g.account_id} size={20} /> {shortAccount(g.account_id)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function PoolStats({ event }: { event: EventView }) {
  const stats = [
    { label: "Deposit", value: `${formatUsdc(event.deposit)} USDC` },
    { label: "Going", value: `${event.guest_count} / ${event.capacity}` },
    { label: "Pool", value: `${formatUsdc(event.total_pool)} USDC` },
    event.status === "Finalized"
      ? { label: "Paid per attendee", value: `${formatUsdc(event.payout_per_attendee)} USDC` }
      : { label: "Sponsor bonus", value: `${formatUsdc(event.bonus_pool)} USDC` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
      {stats.map((s) => (
        <div key={s.label} className="bg-surface p-4">
          <div className="text-xs text-muted">{s.label}</div>
          <div className="font-semibold mt-1">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function RegistrationCard({
  event,
  myStatus,
  onChange,
}: {
  event: EventView;
  myStatus: GuestStatus | null;
  onChange: () => Promise<void>;
}) {
  const { accountId, send } = useWallet();
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
