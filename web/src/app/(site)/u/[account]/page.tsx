"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { events, formatUsdc, type EventView, type GuestStatus } from "@/lib/near";
import { Avatar, Cover, StatusPill, shortAccount } from "@/components/ui";

interface Row {
  event: EventView;
  status: GuestStatus | null;
}

/** Public track record, like Kickback's profile: what someone signed up for and whether they came. */
export default function Profile() {
  const account = decodeURIComponent(useParams<{ account: string }>().account);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hosting, setHosting] = useState<EventView[]>([]);

  useEffect(() => {
    (async () => {
      const [ids, all] = await Promise.all([events.guestEvents(account).catch((): number[] => []), events.list()]);
      const mine = all.filter((e) => ids.includes(e.id));
      // One at a time: the public RPC rate-limits bursts.
      const statuses: (GuestStatus | null)[] = [];
      for (const e of mine) statuses.push(await events.guestStatus(e.id, account).catch(() => null));
      setRows(mine.map((event, i) => ({ event, status: statuses[i] })));
      setHosting(all.filter((e) => e.host === account || e.cohosts.includes(account)));
    })();
  }, [account]);

  const closed = rows?.filter((r) => r.event.status === "Finalized") ?? [];
  const came = closed.filter((r) => r.status === "Attended");
  const earned = came.reduce((sum, r) => sum + BigInt(r.event.payout_per_attendee) - BigInt(r.event.deposit), 0n);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Avatar account={account} size={64} />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-all">{shortAccount(account)}</h1>
          <p className="text-sm text-muted break-all">{account}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border rounded-2xl overflow-hidden border border-border">
        {[
          ["Registered", rows ? String(rows.length) : "…"],
          ["Showed up", closed.length ? `${came.length} of ${closed.length}` : "—"],
          ["Show-up rate", closed.length ? `${Math.round((came.length / closed.length) * 100)}%` : "—"],
          ["Earned from no-shows", `${formatUsdc(earned)} USDC`],
        ].map(([l, v]) => (
          <div key={l} className="bg-surface p-4">
            <div className="text-xs text-muted">{l}</div>
            <div className="font-semibold mt-1">{v}</div>
          </div>
        ))}
      </div>

      <List title="Events" rows={rows ?? []} empty={rows ? "No events yet." : "Loading…"} />
      {hosting.length > 0 && <List title="Hosting" rows={hosting.map((event) => ({ event, status: null }))} />}
    </div>
  );
}

function List({ title, rows, empty }: { title: string; rows: Row[]; empty?: string }) {
  const label = (r: Row) =>
    r.status === null
      ? null
      : r.event.status === "Finalized"
        ? r.status === "Attended"
          ? ["Showed up", "bg-good/15 text-good"]
          : ["No-show", "bg-border/60 text-muted"]
        : r.status === "Attended"
          ? ["Checked in", "bg-good/15 text-good"]
          : ["Going", "bg-accent-soft text-accent"];
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      {rows.length === 0 && <p className="text-muted">{empty}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const l = label(r);
          return (
            <Link key={r.event.id} href={`/e/${r.event.id}`} className="card p-3 flex gap-3 items-center hover:border-accent/50">
              <Cover event={r.event} className="w-14 h-14 rounded-lg shrink-0 [&>span]:hidden" />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.event.metadata.title}</div>
                <div className="text-sm text-muted">{new Date(r.event.metadata.starts_at).toLocaleDateString()}</div>
              </div>
              {l ? <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${l[1]}`}>{l[0]}</span> : <StatusPill status={r.event.status} />}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
