import type { EventStatus, EventView } from "@/lib/near";

/** Implicit accounts (Google/email users) and EVM addresses (Intents accounts) are shortened for display. */
export function shortAccount(account: string): string {
  return /^([0-9a-f]{64}|0x[0-9a-f]{40})$/.test(account) ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic gradient avatar for a NEAR account. */
export function Avatar({ account, size = 32 }: { account: string; size?: number }) {
  const h = hash(account);
  const a = h % 360;
  const b = (a + 60 + (h % 90)) % 360;
  return (
    <span
      title={account}
      className="inline-flex shrink-0 items-center justify-center rounded-full text-white font-semibold ring-2 ring-surface"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, hsl(${a} 80% 62%), hsl(${b} 75% 55%))`,
      }}
    >
      {account[0]?.toUpperCase()}
    </span>
  );
}

/** Deterministic title gradient, independent of stored event metadata. */
export function Cover({ event, className = "" }: { event: EventView; className?: string }) {
  const h = hash(event.metadata.title + event.id);
  const a = h % 360;
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `radial-gradient(circle at 20% 20%, hsl(${a} 90% 70%), transparent 55%),
          radial-gradient(circle at 80% 30%, hsl(${(a + 70) % 360} 85% 65%), transparent 50%),
          radial-gradient(circle at 50% 90%, hsl(${(a + 160) % 360} 80% 60%), transparent 60%),
          hsl(${(a + 220) % 360} 60% 25%)`,
      }}
    >
      <span className="absolute bottom-3 left-4 right-4 text-white/90 font-semibold text-lg leading-tight drop-shadow">
        {event.metadata.title}
      </span>
    </div>
  );
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

export function AvatarStack({ accounts, max = 6 }: { accounts: string[]; max?: number }) {
  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {accounts.slice(0, max).map((a) => (
          <Avatar key={a} account={a} size={28} />
        ))}
      </div>
      {accounts.length > max && <span className="ml-2 text-sm text-muted">+{accounts.length - max}</span>}
    </div>
  );
}
