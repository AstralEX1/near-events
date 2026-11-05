"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { checkIns } from "@/lib/checkinsClient";
import { useWallet } from "@/lib/wallet";
import { Avatar, formatWhen, shortAccount } from "@/components/ui";
import { QrScanner } from "@/components/Qr";

type Tab = "overview" | "guests" | "registration";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "guests", label: "Guests" },
  { id: "registration", label: "Registration" },
];

/**
 * Host admin — Luma-style manage: Overview · Guests · Registration.
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const tabParam = search.get("tab");
  const tab: Tab = tabParam === "guests" || tabParam === "registration" || tabParam === "overview" ? tabParam : "guests";

  const setTab = (t: Tab) => {
    const q = new URLSearchParams(search.toString());
    q.set("tab", t);
    router.replace(`/e/${id}/manage?${q}`, { scroll: false });
  };

  const load = useCallback(async () => {
    const [e, g, marks] = await Promise.all([events.get(id), events.guests(id), checkIns.list(id).catch(() => ({}))]);
    // Door check-ins live on our server until finalize puts them on-chain.
    if (e && e.status === "Open") {
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
    load();
  }, [load]);

  useEffect(() => setOrigin(window.location.origin), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? guests.filter((g) => g.account_id.toLowerCase().includes(q)) : guests;
    return [...list].sort((a, b) => {
      if (a.status !== b.status) return a.status === "Attended" ? 1 : -1;
      return a.registered_at - b.registered_at;
    });
  }, [guests, query]);

  if (!event) return <p className="text-muted px-1">Loading…</p>;

  const isHost = accountId === event.host;
  const isStaff = isHost || (!!accountId && event.cohosts.includes(accountId));
  if (!isStaff) {
    return (
      <p className="px-1">
        Only the host and co-hosts can manage this event.{" "}
        <Link href={`/e/${id}`} className="text-accent">
          Back to event
        </Link>
      </p>
    );
  }

  const run = async (methodName: string, args: object, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await send([{ receiverId: EVENTS_CONTRACT, methodName, args, gas: 300_000_000_000_000n, deposit: 1n }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
  const attendedList = guests.filter((g) => g.status === "Attended").map((g) => g.account_id);

  const onScan = (text: string) => {
    const account = text.replace(/^near:/, "").trim().toLowerCase();
    const g = guests.find((x) => x.account_id === account);
    if (!g) setScanNote({ text: `${account.slice(0, 40)} is not on the guest list`, ok: false });
    else if (g.status === "Attended") setScanNote({ text: `${shortAccount(account)} is already checked in`, ok: true });
    else {
      setSelected((prev) => new Set(prev).add(account));
      setScanNote({ text: `✓ ${shortAccount(account)} queued. Confirm check-in when ready.`, ok: true });
    }
  };

  const exportCsv = () => {
    const rows = [
      ["account", "status", "registered_at", "paid_by"],
      ...guests.map((g) => [g.account_id, g.status, new Date(g.registered_at).toISOString(), g.paid_by]),
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
  const paid = guests.length;
  const checkedIn = guests.filter((g) => g.status === "Attended").length;
  const pageUrl = `${origin}/e/${id}`;
  const payUrl = `${origin}/p/${id}`;
  const widgetUrl = `${origin}/widget?event=${id}`;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
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
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1 truncate">{event.metadata.title}</h1>
          <p className="text-sm text-muted mt-1">
            {formatWhen(event.metadata.starts_at, event.metadata.ends_at)}
            {event.metadata.location ? ` · ${event.metadata.location}` : ""}
          </p>
        </div>
        <Link href={`/e/${id}`} className="btn btn-ghost !py-2 text-sm shrink-0" target="_blank">
          Event Page ↗
        </Link>
      </div>

      {/* Tabs — Overview · Guests · Registration only */}
      <nav className="flex gap-5 border-b border-border overflow-x-auto" aria-label="Manage sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`pb-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-text text-text" : "border-transparent text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <p className="text-sm text-warn break-words card p-3">{error}</p>}

      {tab === "overview" && (
        <OverviewTab
          event={event}
          paid={paid}
          checkedIn={checkedIn}
          pool={pool}
          share={share}
          open={open}
          isHost={isHost}
          busy={busy}
          pageUrl={pageUrl}
          payUrl={payUrl}
          widgetUrl={widgetUrl}
          copied={copied}
          onCopy={copy}
          onGuests={() => setTab("guests")}
          onRegistration={() => setTab("registration")}
          onFinalize={() =>
            run(
              "finalize",
              { event_id: id, attended: attendedList },
              event.attended_count === 0
                ? "Nobody was checked in, so every deposit goes back to its guest. Close the event?"
                : `Close the event and pay out?\n\n${event.attended_count} of ${event.guest_count} came.\nPool: ${formatUsdc(pool)} USDC.\nEach attendee gets ${formatUsdc(share)} USDC.\n\nThis cannot be undone.`,
            )
          }
          onCancel={() => run("cancel", { event_id: id }, "Cancel the event and refund every guest deposit?")}
        />
      )}

      {tab === "guests" && (
        <GuestsTab
          open={open}
          isHost={isHost}
          busy={busy}
          paid={paid}
          checkedIn={checkedIn}
          share={share}
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
          onRefund={(account) =>
            run("refund_guest", { event_id: id, account_id: account }, `Return ${account}’s deposit and free their spot?`)
          }
          onExport={exportCsv}
          onInvite={() => {
            setTab("registration");
          }}
          onFinalize={() =>
            run(
              "finalize",
              { event_id: id, attended: attendedList },
              event.attended_count === 0
                ? "Nobody was checked in, so every deposit goes back to its guest. Close the event?"
                : `Close & pay out ${formatUsdc(pool)} USDC to ${event.attended_count} guests (${formatUsdc(share)} each)?`,
            )
          }
        />
      )}

      {tab === "registration" && (
        <RegistrationTab
          event={event}
          open={open}
          pageUrl={pageUrl}
          payUrl={payUrl}
          widgetUrl={widgetUrl}
          copied={copied}
          onCopy={copy}
        />
      )}
    </div>
  );
}

function OverviewTab({
  event,
  paid,
  checkedIn,
  pool,
  share,
  open,
  isHost,
  busy,
  pageUrl,
  payUrl,
  widgetUrl,
  copied,
  onCopy,
  onGuests,
  onRegistration,
  onFinalize,
  onCancel,
}: {
  event: EventView;
  paid: number;
  checkedIn: number;
  pool: bigint;
  share: bigint;
  open: boolean;
  isHost: boolean;
  busy: boolean;
  pageUrl: string;
  payUrl: string;
  widgetUrl: string;
  copied: string | null;
  onCopy: (k: string, v: string) => void;
  onGuests: () => void;
  onRegistration: () => void;
  onFinalize: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">At a Glance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Paid" value={String(paid)} />
          <Stat label="Checked in" value={String(checkedIn)} />
          <Stat label="Pool" value={`${formatUsdc(pool)} USDC`} />
          <Stat label="Each if closed" value={checkedIn ? `${formatUsdc(share)}` : "—"} />
        </div>
      </section>

      <section className="grid sm:grid-cols-3 gap-3">
        <ActionTile
          tone="blue"
          title="Invite / share"
          body="Copy links for the page or a bare payment URL"
          onClick={onRegistration}
        />
        <ActionTile tone="green" title="Check in guests" body="QR scan or tap a name" onClick={onGuests} />
        <ActionTile
          tone="amber"
          title="Registration"
          body={`${formatUsdc(event.deposit)} USDC deposit · ${event.capacity} spots`}
          onClick={onRegistration}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Share</h2>
        <CopyRow label="Event page" value={pageUrl} copied={copied === "page"} onCopy={() => onCopy("page", pageUrl)} />
        <CopyRow label="Payment link" value={payUrl} copied={copied === "pay"} onCopy={() => onCopy("pay", payUrl)} />
        <CopyRow label="Integrate widget" value={widgetUrl} copied={copied === "widget"} onCopy={() => onCopy("widget", widgetUrl)} link />
      </section>

      {open && isHost && (
        <section className="pt-2 space-y-3 border-t border-border">
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={onFinalize}>
            Close event &amp; pay out
          </button>
          <div>
            <button type="button" className="text-sm text-muted hover:text-warn" disabled={busy} onClick={onCancel}>
              Cancel event &amp; refund everyone
            </button>
          </div>
        </section>
      )}
      {!open && (
        <p className="text-sm text-muted">
          This event is <span className="text-text font-medium">{event.status === "Finalized" ? "paid out" : "cancelled"}</span>.
        </p>
      )}
      {open && !isHost && (
        <p className="text-sm text-muted">Only the host ({shortAccount(event.host)}) can close the event. You can check guests in.</p>
      )}
    </div>
  );
}

function GuestsTab({
  open,
  isHost,
  busy,
  paid,
  checkedIn,
  share,
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
  onRefund,
  onExport,
  onInvite,
  onFinalize,
}: {
  open: boolean;
  isHost: boolean;
  busy: boolean;
  paid: number;
  checkedIn: number;
  share: bigint;
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
  onRefund: (a: string) => void;
  onExport: () => void;
  onInvite: () => void;
  onFinalize: () => void;
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <div className="text-sm text-muted">At a Glance</div>
          <div className="text-3xl font-semibold tracking-tight mt-1">
            {paid} Going
            <span className="text-lg font-medium text-muted ml-2">· {checkedIn} in</span>
          </div>
          {checkedIn > 0 && <p className="text-sm text-muted mt-1">~{formatUsdc(share)} USDC each if you close now</p>}
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
              Close camera
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
          placeholder="Find by account"
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
              Get share links
            </button>
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {filtered.map((g) => {
              const attended = g.status === "Attended";
              const queued = selected.has(g.account_id);
              return (
                <li key={g.account_id} className="flex items-center gap-3 px-3 sm:px-4 min-h-14 py-2">
                  <Avatar account={g.account_id} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate" title={g.account_id}>
                      {shortAccount(g.account_id)}
                    </div>
                    <div className="text-xs text-muted">
                      {attended ? "Checked in" : "Paid · going"}
                      {g.paid_by !== g.account_id ? ` · paid by ${shortAccount(g.paid_by)}` : ""}
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
                        {isHost && (
                          <button
                            type="button"
                            className="h-10 px-2 text-xs text-muted hover:text-warn"
                            disabled={busy}
                            onClick={() => onRefund(g.account_id)}
                          >
                            Refund
                          </button>
                        )}
                        <button
                          type="button"
                          className={`btn !py-2 !px-3 text-sm ${queued ? "btn-accent" : "btn-ghost"}`}
                          disabled={busy}
                          onClick={() => onCheckInOne(g.account_id)}
                        >
                          Check in
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
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={onFinalize}>
            Close event &amp; pay out
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
  widgetUrl,
  copied,
  onCopy,
}: {
  event: EventView;
  open: boolean;
  pageUrl: string;
  payUrl: string;
  widgetUrl: string;
  copied: string | null;
  onCopy: (k: string, v: string) => void;
}) {
  return (
    <div className="space-y-8">
      <div className="grid sm:grid-cols-3 gap-3">
        <StatusCard
          icon="🎟️"
          label="Registration"
          value={open ? "Open" : event.status === "Finalized" ? "Closed" : "Cancelled"}
          good={open}
        />
        <StatusCard icon="↑" label="Capacity" value={`${event.guest_count} / ${event.capacity}`} />
        <StatusCard icon="◎" label="Deposit" value={`${formatUsdc(event.deposit)} USDC`} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">How guests sign up</h2>
        </div>
        <div className="card p-4 space-y-1">
          <div className="font-medium">Standard deposit</div>
          <p className="text-sm text-muted">
            Same amount for everyone. Who shows up gets it back plus a share of no-shows. No platform fee.
          </p>
          <div className="text-sm font-mono mt-2">{formatUsdc(event.deposit)} USDC · {event.capacity} spots</div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Share &amp; integrate</h2>
        <p className="text-sm text-muted">Put registration on your site, or share a link anywhere.</p>
        <CopyRow label="Event page" value={pageUrl} copied={copied === "page"} onCopy={() => onCopy("page", pageUrl)} />
        <CopyRow
          label="Bare payment link"
          value={payUrl}
          copied={copied === "pay"}
          onCopy={() => onCopy("pay", payUrl)}
          hint="Instagram, WhatsApp, anywhere a URL works"
        />
        <div className="card p-4 space-y-3">
          <div>
            <div className="font-medium">Want to integrate on your website?</div>
            <p className="text-sm text-muted mt-1">
              AI prompt or two lines of embed code. Guests deposit with us; your page stays the front door.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={widgetUrl} className="btn btn-primary !py-2 text-sm">
              Open integrate guide
            </Link>
            <button type="button" className="btn btn-ghost !py-2 text-sm" onClick={() => onCopy("widget", widgetUrl)}>
              {copied === "widget" ? "Copied link" : "Copy widget link"}
            </button>
          </div>
        </div>
      </section>

      {event.cohosts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted">Door team</h2>
          <ul className="space-y-2">
            {event.cohosts.map((a) => (
              <li key={a} className="flex items-center gap-2 text-sm">
                <Avatar account={a} size={24} />
                <span className="truncate">{shortAccount(a)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-xl font-semibold tracking-tight mt-1 truncate">{value}</div>
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
          <button type="button" className="btn btn-ghost !py-1.5 text-sm shrink-0" onClick={onCopy} disabled={!value}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
