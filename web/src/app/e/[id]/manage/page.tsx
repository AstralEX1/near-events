"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT, INTENTS_CONTRACT, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Avatar, StatusPill } from "@/components/ui";

export default function ManageEvent() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId, send } = useWallet();
  const [event, setEvent] = useState<EventView | null>(null);
  const [guests, setGuests] = useState<GuestView[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [e, g] = await Promise.all([events.get(id), events.guests(id)]);
    setEvent(e);
    setGuests(g);
    setSelected(new Set());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => guests.filter((g) => g.account_id.toLowerCase().includes(query.toLowerCase())),
    [guests, query],
  );

  if (!event) return <p className="text-muted">Loading…</p>;
  const isHost = accountId === event.host;
  const isStaff = isHost || (!!accountId && event.cohosts.includes(accountId));
  if (!isStaff) {
    return (
      <p>
        Only the host and co-hosts can manage this event. <Link href={`/e/${id}`} className="text-accent">Back to event</Link>
      </p>
    );
  }

  const run = async (methodName: string, args: object, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await send([{ receiverId: EVENTS_CONTRACT, methodName, args, gas: 300_000_000_000_000n }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (a: string) => {
    const next = new Set(selected);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    setSelected(next);
  };

  const open = event.status === "Open";
  const pool = BigInt(event.total_pool);
  const share = event.attended_count > 0 ? pool / BigInt(event.attended_count) : 0n;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/e/${id}`} className="text-muted hover:text-text">← {event.metadata.title}</Link>
        <StatusPill status={event.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Checked in" value={`${event.attended_count} / ${event.guest_count}`} />
        <Stat label="Pool" value={`${formatUsdc(pool)} USDC`} />
        <Stat label="Each attendee would get" value={event.attended_count ? `${formatUsdc(share)} USDC` : "—"} />
      </div>

      <div className="card">
        <div className="p-3 flex gap-2 border-b border-border">
          <input className="input" placeholder="Search guest account…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {open && (
            <button
              className="btn btn-accent whitespace-nowrap"
              disabled={busy || selected.size === 0}
              onClick={() => run("check_in", { event_id: id, accounts: [...selected] })}
            >
              Check in {selected.size > 0 && `(${selected.size})`}
            </button>
          )}
        </div>
        {filtered.length === 0 && <p className="p-4 text-muted text-sm">No guests yet.</p>}
        <ul>
          {filtered.map((g) => {
            const attended = g.status === "Attended";
            return (
              <li key={g.account_id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0">
                {open && !attended ? (
                  <input type="checkbox" className="w-4 h-4 accent-[var(--accent)]" checked={selected.has(g.account_id)} onChange={() => toggle(g.account_id)} />
                ) : (
                  <span className="w-4 text-good text-center">{attended ? "✓" : ""}</span>
                )}
                <Avatar account={g.account_id} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{g.account_id}</div>
                  {g.paid_by !== g.account_id && <div className="text-xs text-muted truncate">paid by {g.paid_by}</div>}
                </div>
                {attended ? (
                  <>
                    <span className="text-xs font-medium text-good">Checked in</span>
                    {open && (
                      <button className="text-xs text-muted hover:text-warn" disabled={busy} onClick={() => run("undo_check_in", { event_id: id, account_id: g.account_id })}>
                        undo
                      </button>
                    )}
                  </>
                ) : (
                  open && (
                    <button className="btn btn-ghost !py-1 !px-3 text-sm" disabled={busy} onClick={() => run("check_in", { event_id: id, accounts: [g.account_id] })}>
                      Check in
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="text-sm text-warn break-words">{error}</p>}

      {/* Sputnik DAOs live under sputnik-dao.near (mainnet) or sputnik-v2.testnet. */}
      {open && event.host.includes("sputnik") && <DaoSponsor eventId={id} dao={event.host} />}

      {open && (
        <div className="card p-4 space-y-3">
          <div className="font-semibold">Close the event</div>
          {isHost ? (
            <>
              <p className="text-sm text-muted">
                Finalize splits the pool between checked-in guests. If nobody was checked in, everyone gets their deposit
                back. A DAO host finalizes through a DAO proposal instead.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run("finalize", { event_id: id }, `Pay out ${formatUsdc(pool)} USDC to ${event.attended_count} attendees? This cannot be undone.`)}
                >
                  Finalize & pay out
                </button>
                <button className="btn btn-ghost text-warn" disabled={busy} onClick={() => run("cancel", { event_id: id }, "Cancel the event and refund every deposit?")}>
                  Cancel event
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              Only the host ({event.host}) can finalize. If the host is a DAO, its members vote on the payout in Trezu.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}

/** Proposal the host DAO can paste into Trezu (custom function call) to add a bonus to the pool. */
function DaoSponsor({ eventId, dao }: { eventId: number; dao: string }) {
  const [amount, setAmount] = useState("10");
  const units = String(Math.round(Number(amount || "0") * 1_000_000));
  const msg = JSON.stringify({ action: "sponsor", event_id: eventId });
  // From the DAO's NEAR Intents balance (mainnet) or straight from its USDC (any network).
  const call = INTENTS_CONTRACT
    ? { contract: INTENTS_CONTRACT, method: "ft_withdraw", args: { token: USDC_CONTRACT, receiver_id: EVENTS_CONTRACT, amount: units, msg }, deposit: "1 yoctoNEAR", gas: "150 Tgas" }
    : { contract: USDC_CONTRACT, method: "ft_transfer_call", args: { receiver_id: EVENTS_CONTRACT, amount: units, msg }, deposit: "1 yoctoNEAR", gas: "150 Tgas" };
  return (
    <div className="card p-4 space-y-3">
      <div className="font-semibold">Sponsor the pool from the DAO treasury</div>
      <p className="text-sm text-muted">
        Create a <b>custom function call</b> proposal in Trezu for <b>{dao}</b> with these values. When the council approves,
        the bonus is added to the pool{INTENTS_CONTRACT ? ", paid from the DAO’s NEAR Intents balance" : ""}.
      </p>
      <input className="input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <pre className="text-xs bg-bg rounded-xl p-3 overflow-x-auto">{JSON.stringify(call, null, 2)}</pre>
    </div>
  );
}
