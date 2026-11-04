"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { Avatar } from "@/components/ui";
import { QrScanner } from "@/components/Qr";

export default function ManageEvent() {
  const id = Number(useParams<{ id: string }>().id);
  const { accountId, send } = useWallet();
  const [event, setEvent] = useState<EventView | null>(null);
  const [guests, setGuests] = useState<GuestView[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ text: string; ok: boolean } | null>(null);

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
      // Host and co-host actions need 1 yoctoNEAR, so only a full-access key can make them.
      await send([{ receiverId: EVENTS_CONTRACT, methodName, args, gas: 300_000_000_000_000n, deposit: 1n }]);
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

  // A guest's QR holds their account id. Scans queue guests for one batched check-in.
  const onScan = (text: string) => {
    const account = text.replace(/^near:/, "").trim().toLowerCase();
    const g = guests.find((x) => x.account_id === account);
    if (!g) setScanNote({ text: `${account.slice(0, 40)} is not on the guest list`, ok: false });
    else if (g.status === "Attended") setScanNote({ text: `${account} is already checked in`, ok: true });
    else {
      setSelected((prev) => new Set(prev).add(account));
      setScanNote({ text: `✓ ${account} added. Press “Check in” when the queue is done.`, ok: true });
    }
  };

  const exportCsv = () => {
    const rows = [["account", "status", "registered_at", "paid_by"], ...guests.map((g) => [g.account_id, g.status, new Date(g.registered_at).toISOString(), g.paid_by])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `event-${id}-guests.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const open = event.status === "Open";
  const pool = BigInt(event.total_pool);
  const share = event.attended_count > 0 ? pool / BigInt(event.attended_count) : 0n;

  // Phone-first door screen: one line of numbers, the camera, the list, one closing button.
  return (
    <div className="max-w-md mx-auto space-y-4">
      <div>
        <Link href={`/e/${id}`} className="text-sm text-muted hover:text-text">← {event.metadata.title}</Link>
        <h1 className="text-xl font-semibold mt-1">Check-in</h1>
        <p className="text-sm text-muted">
          {event.attended_count} of {event.guest_count} in
          {event.attended_count > 0 && ` · ${formatUsdc(share)} USDC each`}
          {!open && ` · ${event.status === "Finalized" ? "paid out" : "cancelled"}`}
        </p>
      </div>

      {open &&
        (scanning ? (
          <QrScanner onScan={onScan} onClose={() => setScanning(false)} />
        ) : (
          <button className="btn btn-primary w-full !py-3.5" onClick={() => setScanning(true)}>
            Scan guest codes
          </button>
        ))}
      {scanNote && <p className={`text-sm ${scanNote.ok ? "text-good" : "text-warn"}`}>{scanNote.text}</p>}
      {open && selected.size > 0 && (
        <button className="btn btn-accent w-full" disabled={busy} onClick={() => run("check_in", { event_id: id, accounts: [...selected] })}>
          Check in {selected.size} scanned {selected.size === 1 ? "guest" : "guests"}
        </button>
      )}

      <input className="input" placeholder="Or find by name" aria-label="Find guest" value={query} onChange={(e) => setQuery(e.target.value)} />

      <ul>
        {filtered.length === 0 && <li className="py-3 text-sm text-muted">No guests yet.</li>}
        {filtered.map((g) => {
          const attended = g.status === "Attended";
          return (
            <li key={g.account_id} className="flex items-center gap-3 h-14 border-b border-border">
              <Avatar account={g.account_id} size={32} />
              <span className="flex-1 min-w-0 truncate font-medium" title={g.account_id}>{g.account_id}</span>
              {attended ? (
                <button
                  className="h-11 px-3 font-semibold text-good disabled:opacity-100"
                  disabled={busy || !open}
                  aria-label="Undo check-in"
                  onClick={() => run("undo_check_in", { event_id: id, account_id: g.account_id })}
                >
                  ✓ In
                </button>
              ) : (
                open && (
                  <>
                  {isHost && (
                    <button
                      className="h-11 px-2 text-xs text-muted hover:text-warn"
                      disabled={busy}
                      onClick={() =>
                        run("refund_guest", { event_id: id, account_id: g.account_id }, `Return ${g.account_id}’s deposit and free their spot?`)
                      }
                    >
                      Refund
                    </button>
                  )}
                  <button
                    className={`btn !py-2 ${selected.has(g.account_id) ? "btn-accent" : "btn-ghost"}`}
                    disabled={busy}
                    onClick={() => run("check_in", { event_id: id, accounts: [g.account_id] })}
                  >
                    Check in
                  </button>
                  </>
                )
              )}
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-warn break-words">{error}</p>}

      {open && isHost && (
        <div className="pt-2 space-y-2">
          <button
            className="btn btn-primary w-full !py-3.5"
            disabled={busy}
            onClick={() => run("finalize", { event_id: id }, event.attended_count === 0
                ? "Nobody was checked in, so every deposit goes back to its guest. Close the event?"
                : `Close the event and pay out?\n\n${event.attended_count} of ${event.guest_count} came.\nPool: ${formatUsdc(pool)} USDC.\nEach attendee gets ${formatUsdc(share)} USDC.\n\nThis cannot be undone.`)}
          >
            Close event & pay out
          </button>
          <div className="flex justify-between text-xs text-muted">
            <button className="hover:text-warn" disabled={busy} onClick={() => run("cancel", { event_id: id }, "Cancel the event and refund every guest deposit and sponsor bonus?")}>
              Cancel event
            </button>
            {guests.length > 0 && <button className="hover:text-text" onClick={exportCsv}>Download guest list</button>}
          </div>
        </div>
      )}
      {open && !isHost && (
        <p className="text-xs text-muted">
          Only the host ({event.host}) can close the event. Co-hosts can check guests in.
        </p>
      )}
    </div>
  );
}
