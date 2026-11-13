"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { events, type EventView, type GuestStatus } from "@/lib/near";
import { Cover, StatusPill, shortAccount } from "@/components/ui";
import { ProfileCard } from "@/components/ProfileCard";
import { getProfiles } from "@/lib/profilesClient";
import { useReputation } from "@/lib/reputation";
import type { Profile as UserProfile } from "@/lib/profilesShared";
import { Timeline } from "@/components/Timeline";
import { cohosts as cohostsApi } from "@/lib/cohostsClient";

interface Row {
  event: EventView;
  status: GuestStatus | null;
}

/**
 * A person's public page: for hosts, their events like a Luma calendar page;
 * for guests, a Kickback-style track record of what they signed up for and whether they came.
 */
export default function Profile() {
  const account = decodeURIComponent(useParams<{ account: string }>().account);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hosting, setHosting] = useState<EventView[]>([]);
  const reputation = useReputation(account);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    getProfiles([account]).then((p) => setProfile(p[account] ?? null)).catch(() => setProfile(null));
  }, [account]);

  useEffect(() => {
    (async () => {
      const all = await events.listPublic(true);
      const ids = all.map((e) => e.id);
      const [statuses, teams] = await Promise.all([
        events.guestStatuses(account, ids),
        cohostsApi.many(ids).catch((): Record<number, string[]> => ({})),
      ]);
      setRows(all.flatMap((event, i) => statuses[i] ? [{ event, status: statuses[i] }] : []));
      setHosting(all.filter((e) => e.host === account || teams[e.id]?.includes(account)));
    })();
  }, [account]);

  const closed = rows?.filter((r) => r.event.status === "Finalized") ?? [];
  const came = closed.filter((r) => r.status === "Attended");
  const upcoming = hosting.filter((e) => e.status === "Open").sort((a, b) => a.metadata.starts_at - b.metadata.starts_at);
  // Held = their own events closed with the guests who came, the same count as the badge; door-team help doesn't count.
  const held = hosting.filter((e) => e.host === account && e.status === "Finalized").sort((a, b) => b.metadata.starts_at - a.metadata.starts_at);

  return (
    <div className="space-y-8">
      <ProfileCard account={account} profile={profile} reputation={reputation} showUp={{ came: came.length, of: closed.length }} />

      {upcoming.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Upcoming by {shortAccount(account)}</h2>
          <Timeline items={upcoming} empty="" />
        </section>
      )}
      {held.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Held by {shortAccount(account)} · {held.length}</h2>
          <Timeline items={held} empty="" />
        </section>
      )}

      <List title="Events" rows={rows ?? []} empty={rows ? "No events yet." : "Loading…"} />

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
