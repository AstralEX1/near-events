"use client";

import Link from "next/link";
import type { EventStatus, EventView } from "@/lib/near";
import { useEventVisual } from "@/lib/event-visual-client";
import { meshGradient, seededRandom, type EventVisualConfig } from "@/lib/event-visuals";
import { EventPoster } from "@/components/EventVisual";

/** Implicit accounts (Google/email users) and EVM addresses (Intents accounts) are shortened for display. Named accounts drop the `.testnet` suffix in the UI. */
export function shortAccount(account: string): string {
  if (/^([0-9a-f]{64}|0x[0-9a-f]{40})$/.test(account)) return `${account.slice(0, 6)}…${account.slice(-4)}`;
  return account.endsWith(".testnet") ? account.slice(0, -".testnet".length) : account;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Fully random colours from a profile's avatar seed: any hues, saturation and lightness, no theme. */
function randomAvatarColors(seed: number): string[] {
  const random = seededRandom(seed);
  return Array.from({ length: 4 }, () => `hsl(${Math.round(random() * 360)} ${Math.round(45 + random() * 55)}% ${Math.round(35 + random() * 45)}%)`);
}

/**
 * An uploaded photo, else generated soft colour blobs: from the profile's random seed when the person
 * picked one, otherwise from the account name, so everyone sees the same picture.
 */
export function Avatar({ account, size = 32, src, seed }: { account: string; size?: number; src?: string | null; seed?: number | null }) {
  if (src) return <img src={src} alt={account} data-tooltip={account} width={size} height={size} className="inline-block shrink-0 rounded-full ring-2 ring-surface object-cover" style={{ width: size, height: size }} />;
  const h = seed ?? hash(account);
  const hue = h % 360;
  const colors = seed != null ? randomAvatarColors(seed) : [0, 45, 160, 210].map((shift, i) => `hsl(${(hue + shift) % 360} ${70 + i * 5}% ${58 + (i % 2) * 10}%)`);
  return (
    <span
      role="img"
      aria-label={account}
      data-tooltip={account}
      className="inline-block shrink-0 rounded-full ring-2 ring-surface"
      style={{ width: size, height: size, backgroundColor: colors[0], backgroundImage: meshGradient(h, colors.slice(1), 3) }}
    />
  );
}

/** The cover is rendered from the exact title and a stable, off-chain visual choice. */
export function Cover({ event, className = "", coverUrl = null, visual }: { event: EventView; className?: string; coverUrl?: string | null; visual?: EventVisualConfig }) {
  const savedVisual = useEventVisual(event.id, event.metadata.title);
  return <EventPoster title={event.metadata.title} visual={visual ?? savedVisual} coverUrl={coverUrl} className={className} />;
}

export function DateBadge({ ms }: { ms: number }) {
  const d = new Date(ms);
  return (
    <div className="w-11 shrink-0 rounded-lg border border-border overflow-hidden text-center bg-surface">
      <div className="text-[10px] font-semibold uppercase bg-border/60 text-muted py-0.5">
        {d.toLocaleString("en-US", { month: "short" })}
      </div>
      <div className="text-lg font-semibold leading-7">{d.getDate()}</div>
    </div>
  );
}

const STATUS_STYLE: Record<EventStatus, string> = {
  Open: "bg-accent-soft text-accent",
  Finalized: "bg-good/15 text-good",
  Cancelled: "bg-warn/15 text-warn",
};
const STATUS_LABEL: Record<EventStatus, string> = { Open: "Open", Finalized: "Paid out", Cancelled: "Cancelled" };

export function StatusPill({ status }: { status: EventStatus }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function formatWhen(start: number, end: number): string {
  const s = new Date(start);
  const e = new Date(end);
  const day = s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(s)} – ${t(e)}`;
}

/** Overlapping guest avatars; with `linked`, each opens that person's profile. */
export function AvatarStack({ accounts, max = 6, linked = false }: { accounts: string[]; max?: number; linked?: boolean }) {
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {accounts.slice(0, max).map((a) =>
          linked ? (
            <Link key={a} href={`/u/${encodeURIComponent(a)}`} aria-label={`${shortAccount(a)}'s profile`} className="rounded-full transition-transform duration-150 ease-out hover:-translate-y-0.5 hover:z-10 focus-visible:z-10">
              <Avatar account={a} size={28} />
            </Link>
          ) : (
            <Avatar key={a} account={a} size={28} />
          ),
        )}
      </div>
      {accounts.length > max && <span className="ml-2 text-sm text-muted">+{accounts.length - max}</span>}
    </div>
  );
}
