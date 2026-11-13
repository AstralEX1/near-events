"use client";

import { SlCopy, confirmAction } from "@/components/SlUi";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { cameOf, events, formatUsdc, isTicket, needsBond, registrationOpen, windowText, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { checkIns } from "@/lib/checkinsClient";
import { useWallet } from "@/lib/wallet";
import { Avatar, StatusPill, shortAccount } from "@/components/ui";
import { QrScanner } from "@/components/Qr";
import { IntegrationGuide } from "@/components/IntegrationGuide";
import { Overview, cancelText } from "./Overview";
import { PublicDetailsEditor } from "./PublicDetailsEditor";
import { cohosts as cohostsApi } from "@/lib/cohostsClient";
import { guestNamesApi, type GuestNames } from "@/lib/guestNamesClient";
import { attendedCounts } from "@/lib/reputation";
import { OraclePanel } from "@/components/OraclePanel";
import { hostedStats, type Reputation } from "@/lib/reputationShared";
import { ReputationBadges } from "@/components/ReputationBadges";
import { daoPolicy, hostAccounts, isDaoAccount } from "@/lib/daoHost";
import { functionCallProposal } from "@/lib/daoShared";

type Tab = "overview" | "event" | "guests" | "registration" | "integration";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "event", label: "Event page" },
  { id: "guests", label: "Guests" },
  { id: "registration", label: "Registration" },
  { id: "integration", label: "Integration" },
];

/**
 * Host admin — Luma-style manage: Overview · Guests · Registration · Integration.
 * No Blasts / Insights / More. Door flow lives under Guests (QR + name).
 */
export default function ManageEventPage() {
  return (
    <Suspense fallback={<p className="text-muted px-1">Loading…</p>}>
      <ManageEvent />
    </Suspense>
  );
}

function ManageEvent() {
  const id = Number(useParams<{ id: string }>().id);
  const search = useSearchParams();
  const router = useRouter();
  const { accountId, send, staffToken } = useWallet();
  const [event, setEvent] = useState<EventView | null>(null);
  const [guests, setGuests] = useState<GuestView[]>([]);
  const [guestNames, setGuestNames] = useState<GuestNames>({});
  const [doorTeam, setDoorTeam] = useState<string[]>([]);
  // The host, or the council when a DAO hosts.
  const [hostTeam, setHostTeam] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [reps, setReps] = useState<Record<string, Reputation>>({});

  const tabParam = search.get("tab");
  const tab: Tab = tabParam === "event" || tabParam === "guests" || tabParam === "registration" || tabParam === "integration" ? tabParam : "overview";

  const setTab = (t: Tab) => {
    const q = new URLSearchParams(search.toString());
    q.set("tab", t);
    router.replace(`/e/${id}/manage?${q}`, { scroll: false });
  };

  const load = useCallback(async () => {
    const e = await events.get(id);
    if (!e) throw new Error("Event not found.");
    const [g, team, names, hosts] = await Promise.all([
      events.guests(id),
      cohostsApi.get(id).catch(() => null),
      guestNamesApi.list(id).catch(() => ({})),
      hostAccounts(e.host).catch(() => [e.host]),
    ]);
    if (team) setDoorTeam(team);
    setHostTeam(hosts);
    setGuestNames(names);
    // Door check-ins live on our server until finalize puts them on-chain.
    if (e.status === "Open") {
      const marks = await checkIns.list(id);
      const withMarks = g.map((x): GuestView => (marks[x.account_id] ? { ...x, status: "Attended" } : x));
      setGuests(withMarks);
      setEvent({ ...e, attended_count: withMarks.filter((x) => x.status === "Attended").length });
    } else {
      setEvent(e);
      setGuests(g);
    }
    setSelected(new Set());
  }, [id]);

  useEffect(() => {
    setEvent(null);
    setError(null);
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  useEffect(() => setOrigin(window.location.origin), []);

  // Guests' attended/hosted numbers, loaded only on the Guests tab (one RPC view per guest).
  const guestIds = guests.map((g) => g.account_id).join(",");
  useEffect(() => {
    if (tab !== "guests" || !guestIds) return;
    let live = true;
    const ids = guestIds.split(",");
    Promise.all([attendedCounts(ids), events.all()])
      .then(([counts, all]) => live && setReps(Object.fromEntries(Object.entries(counts).map(([a, n]) => [a, { attended: n, ...hostedStats(all, a) }]))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tab, guestIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? guests.filter((g) => {
          const name = (guestNames[g.account_id] ?? "").toLowerCase();
          return g.account_id.toLowerCase().includes(q) || name.includes(q);
        })
      : guests;
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "Attended" ? 1 : -1;
      return a.registered_at - b.registered_at;
    });
  }, [guests, guestNames, query]);

  const labelFor = (account: string) => guestNames[account] || shortAccount(account);

  if (!event) return <p className="text-muted px-1" role="status">{error ?? "Loading…"}</p>;

  const isHost = !!accountId && hostTeam.includes(accountId);
  // A DAO host acts through proposals its council votes on.
  const daoHost = isDaoAccount(event.host);
  const isStaff = isHost || (!!accountId && doorTeam.includes(accountId));
  if (!isStaff) {
    return (
      <p className="px-1">
        Only the host and the door team can manage this event.{" "}
        <Link href={`/e/${id}`} className="text-accent">
          Back to event
        </Link>
      </p>
    );
  }

  const run = async (methodName: string, args: object, confirmText?: string) => {
    if (confirmText && !(await confirmAction(confirmText, methodName === "cancel" ? "Cancel Event" : isTicket(event) ? "Close Event" : "Publish List"))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (daoHost) {
        // The approving vote runs the call, so it carries the call's gas: ~0.7 Tgas per guest (300 guests: 196 Tgas).
        const tgas = Math.min(250, 50 + Math.ceil(event.guest_count * 0.7));
        const bond = BigInt((await daoPolicy(event.host)).proposal_bond ?? "0");
        await send([{
          receiverId: event.host,
          methodName: "add_proposal",
          args: functionCallProposal({
            description: `Nearvent: ${methodName === "cancel" ? "cancel event" : isTicket(event) ? "close event" : "publish the list for event"} #${id} "${event.metadata.title}"`
              + ("attended" in args ? ` with ${(args as { attended: string[] }).attended.length} of ${event.guest_count} guests checked in` : ""),
            receiverId: EVENTS_CONTRACT, method: methodName, args, deposit: "1", gas: `${tgas}000000000000`,
          }),
          gas: 100_000_000_000_000n,
          deposit: bond,
        }]);
        setNotice(`Proposal created in ${event.host}. It runs once the council approves it (vote with at least ${tgas + 50} Tgas).`);
        return;
      }
      await send([{ receiverId: EVENTS_CONTRACT, methodName, args, gas: 300_000_000_000_000n, deposit: 1n }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Host only: replaces the door team kept on our server (no transaction). */
  const saveDoorTeam = async (list: string[]) => {
    const token = await staffToken();
    setDoorTeam(await cohostsApi.save(token, id, list));
  };

  /** Marks guests at the door on our server (no transaction). */
  const mark = async (accounts: string[], on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const token = await staffToken();
      for (const account of accounts) await checkIns.set(token, id, account, on);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onScan = (text: string) => {
    const account = text.replace(/^near:/, "").trim().toLowerCase();
    const g = guests.find((x) => x.account_id === account);
    if (!g) setScanNote({ text: `${account.slice(0, 40)} is not on the guest list`, ok: false });
    else if (g.status === "Attended") setScanNote({ text: `${labelFor(account)} is already checked in`, ok: true });
    else {
      setSelected((prev) => new Set(prev).add(account));
      setScanNote({ text: `✓ ${labelFor(account)} queued. Confirm check-in when ready.`, ok: true });
    }
  };

  const exportCsv = () => {
    const rows = [
      ["name", "account", "status", "registered_at"],
      ...guests.map((g) => [guestNames[g.account_id] ?? "", g.account_id, g.status, new Date(g.registered_at).toISOString()]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `event-${id}-guests.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1400);
    });
  };

  const open = event.status === "Open";
  const pool = BigInt(event.total_pool);
  const share = event.attended_count > 0 ? pool / BigInt(event.attended_count) : 0n;
  const ticket = isTicket(event);
  const finalizeEvent = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await events.get(id);
      if (!fresh || fresh.status !== "Open") throw new Error("This event is closed or unavailable.");
      if (Date.now() < fresh.metadata.ends_at) {
        // Same rule as the escrow's cancel: a bonded Deposit event only before it starts.
        const canCancel = !fresh.dao || fresh.host_bond === "0" || Date.now() < fresh.metadata.starts_at;
        throw new Error(ticket ? "You can close the event once it ends." : `You can publish the list once the event ends.${canCancel ? " To refund everyone now, cancel the event." : ""}`);
      }
      const [currentGuests, marks] = await Promise.all([events.guests(id), checkIns.list(id)]);
      if (currentGuests.length !== fresh.guest_count) throw new Error("The guest list changed. Try again.");
      const attended = currentGuests.filter((g) => marks[g.account_id]).map((g) => g.account_id);
      const currentPool = BigInt(fresh.total_pool);
      // With a court the list waits out the dispute window; without one it pays out now.
      const after = fresh.dao
        ? `Guests can dispute any record for ${windowText(fresh)}; the council decides. A record they prove wrong costs you your whole bond. Then anyone settles the payouts.`
        : "Payouts go out now.";
      const confirmation = ticket
        ? `Close the event?\n\n${fresh.guest_count} tickets · ${formatUsdc(currentPool)} USDC is already in your balance.\n\nThis cannot be undone.`
        : attended.length === 0
          ? `Publish the list with nobody checked in?\n\nIf nobody came, every deposit goes back to its guest. ${after}\n\nThis cannot be undone.`
          : `Publish who came?\n\n${attended.length} of ${fresh.guest_count} checked in.\nPool: ${formatUsdc(currentPool)} USDC, ${formatUsdc(currentPool / BigInt(attended.length))} USDC each${fresh.dao ? " if nobody disputes" : ""}.\n\n${after}\n\nThis cannot be undone.`;
      await run("finalize", { event_id: id, attended }, confirmation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const paid = guests.length;
  // Door marks while Open (see load), the list after it.
  const checkedIn = event.attended_count;
  const pageUrl = `${origin}/e/${id}`;
  const payUrl = `${origin}/p/${id}`;

  return (
    <div className="max-w-4xl mx-auto space-y-7 pb-16">
      {/* Header — Luma: breadcrumb + title + Event Page */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">
            <Link href="/events" className="hover:text-text">
              Events
            </Link>
            <span className="mx-1.5 opacity-50">›</span>
            <span className="text-muted">Manage</span>
          </p>
          <div className="flex items-center gap-2.5 mt-1 min-w-0">
            <h1 className="gc-page-title break-words">{event.metadata.title}</h1>
            {event.status !== "Open" && <StatusPill status={event.status} />}
          </div>
        </div>
        <Link href={`/e/${id}`} className="btn btn-ghost !py-2 text-sm shrink-0" target="_blank">
          Event Page ↗
        </Link>
      </div>

      {/* Tabs */}
      <nav className="gc-manage-tabs" aria-label="Manage sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="text-sm text-warn break-words card p-3">{error}</p>}
      {notice && <p className="text-sm break-words card p-3">{notice}</p>}

      {tab === "overview" && (
        <>
          <OraclePanel event={event} guests={guests} hostTeam={hostTeam} onChange={load} />
          <Overview
            event={event}
            guests={guests}
            guestNames={guestNames}
            origin={origin}
            isHost={isHost}
            busy={busy}
            onGuests={() => setTab("guests")}
            onCheckIn={() => {
              setTab("guests");
              setScanning(true);
              setScanNote(null);
            }}
            onFinalize={finalizeEvent}
            onCancel={() =>
              run(
                "cancel",
                { event_id: id },
                `Cancel this event?\n\n${cancelText(event)}`,
              )
            }
            doorTeam={doorTeam}
            onSaveDoorTeam={saveDoorTeam}
          />
        </>
      )}

      {tab === "guests" && (
        <GuestsTab
          event={event}
          ticket={ticket}
          open={open}
          isHost={isHost}
          busy={busy}
          paid={paid}
          checkedIn={checkedIn}
          share={share}
          guestNames={guestNames}
          reps={reps}
          query={query}
          onQuery={setQuery}
          scanning={scanning}
          onScanToggle={() => {
            setScanning((s) => !s);
            setScanNote(null);
          }}
          onScanClose={() => setScanning(false)}
          onScan={onScan}
          scanNote={scanNote}
          selected={selected}
          filtered={filtered}
          onCheckInOne={(account) => mark([account], true)}
          onCheckInSelected={() => mark([...selected], true)}
          onUndo={(account) => mark([account], false)}
          onExport={exportCsv}
          onInvite={() => {
            setTab("registration");
          }}
          onFinalize={finalizeEvent}
          ended={Date.now() >= event.metadata.ends_at}
        />
      )}

      {tab === "event" && (isHost
        ? <PublicDetailsEditor eventId={id} title={event.metadata.title} />
        : <p className="text-sm text-muted">Only the event host can edit its public page.</p>)}

      {tab === "registration" && (
        <RegistrationTab
          event={event}
          open={open}
          pageUrl={pageUrl}
          payUrl={payUrl}
          copied={copied}
          onCopy={copy}
        />
      )}

      {tab === "integration" && <IntegrationGuide eventId={id} mode={event.mode ?? "Deposit"} />}
    </div>
  );
}

function GuestsTab({
  event,
  open,
  isHost,
  busy,
  paid,
  checkedIn,
  share,
  guestNames,
  reps,
  query,
  onQuery,
  scanning,
  onScanToggle,
  onScanClose,
  onScan,
  scanNote,
  selected,
  filtered,
  onCheckInOne,
  onCheckInSelected,
  onUndo,
  onExport,
  onInvite,
  ticket,
  onFinalize,
  ended,
}: {
  event: EventView;
  open: boolean;
  isHost: boolean;
  busy: boolean;
  paid: number;
  checkedIn: number;
  share: bigint;
  guestNames: GuestNames;
  reps: Record<string, Reputation>;
  query: string;
  onQuery: (v: string) => void;
  scanning: boolean;
  onScanToggle: () => void;
  onScanClose: () => void;
  onScan: (t: string) => void;
  scanNote: { text: string; ok: boolean } | null;
  selected: Set<string>;
  filtered: GuestView[];
  onCheckInOne: (a: string) => void;
  onCheckInSelected: () => void;
  onUndo: (a: string) => void;
  onExport: () => void;
  onInvite: () => void;
  ticket: boolean;
  onFinalize: () => void;
  /** Finalize opens once the event has ended. */
  ended: boolean;
}) {
  // Past the deadline the escrow refuses the list; only the refund on the event page works.
  const late = !ticket && !!event.submit_by && Date.now() > event.submit_by;
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <div className="text-sm text-muted">At a Glance</div>
          <div className="text-3xl font-semibold tracking-tight mt-1">
            {paid} Going
            <span className="text-lg font-medium text-muted ml-2">· {checkedIn} in</span>
          </div>
          {open && !ticket && checkedIn > 0 && <p className="text-sm text-muted mt-1">~{formatUsdc(share)} USDC each {event.dao ? "if nobody disputes" : "if you publish now"}</p>}
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <ActionTile tone="blue" title="Invite Guests" body="Share page or payment link" onClick={onInvite} />
          <ActionTile
            tone="green"
            title="Check In Guests"
            body={scanning ? "Camera on" : "Scan QR at the door"}
            onClick={onScanToggle}
            active={scanning}
          />
          <ActionTile tone="amber" title="Guest List" body="Paid deposits below" onClick={() => document.getElementById("guest-list")?.scrollIntoView({ behavior: "smooth" })} />
        </div>
      </section>

      {open && scanning && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-medium">Scan guest codes</h3>
            <button type="button" className="text-sm text-muted hover:text-text" onClick={onScanClose}>
              Close Camera
            </button>
          </div>
          <QrScanner onScan={onScan} onClose={onScanClose} />
        </div>
      )}
      {scanNote && <p className={`text-sm ${scanNote.ok ? "text-good" : "text-warn"}`}>{scanNote.text}</p>}
      {open && selected.size > 0 && (
        <button type="button" className="btn btn-accent w-full sm:w-auto" disabled={busy} onClick={onCheckInSelected}>
          Check in {selected.size} scanned {selected.size === 1 ? "guest" : "guests"}
        </button>
      )}

      <section id="guest-list" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Guest List</h2>
          <div className="flex items-center gap-2">
            {paid > 0 && (
              <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={onExport}>
                Download CSV
              </button>
            )}
          </div>
        </div>

        <input
          className="input"
          placeholder="Find by name or account"
          aria-label="Find guest"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />

        {filtered.length === 0 ? (
          <div className="card py-14 px-6 text-center space-y-2">
            <div className="text-4xl opacity-40" aria-hidden>
              👥
            </div>
            <h3 className="font-semibold">No Guests Yet</h3>
            <p className="text-sm text-muted max-w-sm mx-auto">Share the event or payment link so people can leave a deposit.</p>
            <button type="button" className="btn btn-ghost !py-2 text-sm mt-2" onClick={onInvite}>
              Get Share Links
            </button>
          </div>
        ) : (
          <ul className="card divide-y divide-border">
            {filtered.map((g) => {
              const attended = cameOf(event, g);
              const queued = selected.has(g.account_id);
              const name = guestNames[g.account_id];
              return (
                <li key={g.account_id} className="flex items-center gap-3 px-3 sm:px-4 min-h-14 py-2">
                  <Link href={`/u/${encodeURIComponent(g.account_id)}`} aria-label={`${name || shortAccount(g.account_id)}'s profile`} className="shrink-0 rounded-full">
                    <Avatar account={g.account_id} size={36} />
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate" data-tooltip={g.account_id}>{name || shortAccount(g.account_id)}</span>
                      {reps[g.account_id] && (reps[g.account_id].attended || reps[g.account_id].hosted
                        ? <ReputationBadges small {...reps[g.account_id]} />
                        : <span className="text-xs text-muted shrink-0">First event</span>)}
                    </div>
                    <div className="text-xs text-muted">
                      {name ? `${shortAccount(g.account_id)} · ` : ""}
                      {attended ? "Checked in" : "Paid · going"}
                    </div>
                  </div>
                  {attended ? (
                    <button
                      type="button"
                      className="h-10 px-3 font-semibold text-good text-sm"
                      disabled={busy || !open}
                      aria-label="Undo check-in"
                      onClick={() => onUndo(g.account_id)}
                    >
                      ✓ In
                    </button>
                  ) : (
                    open && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          className={`btn !py-2 !px-3 text-sm ${queued ? "btn-accent" : "btn-ghost"}`}
                          disabled={busy}
                          onClick={() => onCheckInOne(g.account_id)}
                        >
                          Check In
                        </button>
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && isHost && paid > 0 && (
        <div className="pt-2 border-t border-border">
          <button
            type="button"
            className="btn btn-primary w-full sm:w-auto"
            disabled={busy || !ended || late}
            data-tooltip={!ended ? "Available once the event ends" : late ? `Too late: the deadline was ${new Date(event.submit_by!).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : undefined}
            onClick={onFinalize}
          >
            {ticket ? "Close Event & Get Paid" : "Publish Who Came"}
          </button>
        </div>
      )}
    </div>
  );
}

function RegistrationTab({
  event,
  open,
  pageUrl,
  payUrl,
  copied,
  onCopy,
}: {
  event: EventView;
  open: boolean;
  pageUrl: string;
  payUrl: string;
  copied: string | null;
  onCopy: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatusCard
          icon="🎟️"
          label="Registration"
          value={open ? (needsBond(event) ? "Waiting for bond" : registrationOpen(event) ? "Open" : "Closed") : event.status === "Finalized" ? "Closed" : event.status === "Submitted" ? "List published" : event.status}
          good={registrationOpen(event)}
        />
        <StatusCard icon="↑" label="Capacity" value={`${event.guest_count} / ${event.capacity}`} />
        <StatusCard icon="◎" label={isTicket(event) ? "Ticket" : "Deposit"} value={`${formatUsdc(event.deposit)} USDC`} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">How guests sign up</h2>
        </div>
        <div className="card p-4 space-y-1">
          <div className="font-medium">{isTicket(event) ? "Paid ticket" : "Standard deposit"}</div>
          <p className="text-sm text-muted">
            {isTicket(event)
              ? "Same price for everyone. Each ticket goes to your Nearvent balance as soon as the guest registers. No platform fee."
              : "Same amount for everyone. Who shows up gets it back plus a share of no-shows. No platform fee."}
          </p>
          <div className="text-sm font-mono mt-2">{formatUsdc(event.deposit)} USDC · {event.capacity} spots</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Registration links</h2>
        <CopyRow label="Event page" value={pageUrl} copied={copied === "page"} onCopy={() => onCopy("page", pageUrl)} />
        <CopyRow
          label="Quick checkout link"
          value={payUrl}
          copied={copied === "pay"}
          onCopy={() => onCopy("pay", payUrl)}
          hint="Opens checkout directly; use in a message or behind your own button"
        />
      </section>

    </div>
  );
}

function StatusCard({ icon, label, value, good }: { icon: string; label: string; value: string; good?: boolean }) {
  return (
    <div className="card p-4 flex gap-3 items-start">
      <span className="text-xl leading-none mt-0.5" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className={`font-semibold mt-0.5 ${good ? "text-good" : ""}`}>{value}</div>
      </div>
    </div>
  );
}

function ActionTile({
  tone,
  title,
  body,
  onClick,
  active,
}: {
  tone: "blue" | "green" | "amber";
  title: string;
  body: string;
  onClick: () => void;
  active?: boolean;
}) {
  const bg = tone === "blue" ? "bg-sky-500/15 text-sky-400" : tone === "green" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-4 text-left space-y-3 hover:border-accent/40 transition-colors ${active ? "border-accent bg-accent-soft/30" : ""}`}
    >
      <span className={`inline-flex w-10 h-10 rounded-xl items-center justify-center text-lg ${bg}`} aria-hidden>
        {tone === "blue" ? "✦" : tone === "green" ? "▣" : "☰"}
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-sm text-muted mt-0.5">{body}</p>
      </div>
    </button>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
  link,
  hint,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
  link?: boolean;
  hint?: string;
}) {
  return (
    <div className="card p-3 sm:p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted hidden sm:block">{hint}</div>}
      </div>
      <div className="flex gap-2">
        <code className="flex-1 min-w-0 truncate text-xs bg-bg rounded-lg px-3 py-2 border border-border">{value || "…"}</code>
        {link ? (
          <Link href={value || "#"} className="btn btn-ghost !py-1.5 text-sm shrink-0">
            Open
          </Link>
        ) : (
          value && <SlCopy text={value} />
        )}
      </div>
    </div>
  );
}
