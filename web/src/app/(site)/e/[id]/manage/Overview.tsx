"use client";

import { SlCopy } from "@/components/SlUi";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUsdc, hostBondFor, isTicket, priceLabel, registrationEndsAt, windowText, type EventView, type GuestView } from "@/lib/near";
import { Avatar, Cover, DateBadge, shortAccount } from "@/components/ui";
import { cohostsProblem, splitCohosts } from "@/lib/cohostsShared";
import type { GuestNames } from "@/lib/guestNamesClient";
import { guestStatus } from "@/lib/eventLines";

/** How many of the newest guests the Overview shows before "All Guests". */
const RECENT_GUESTS = 5;

const when = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** Time only when it is today. */
const soon = (ms: number) =>
  new Date(ms).toDateString() === new Date().toDateString()
    ? new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : when(ms);


type Props = {
  event: EventView;
  guests: GuestView[];
  guestNames: GuestNames;
  origin: string;
  isHost: boolean;
  busy: boolean;
  onGuests: () => void;
  onCheckIn: () => void;
  onFinalize: () => void;
  onCancel: () => void;
  /** Door team kept on our server; only the host can change it. */
  doorTeam: string[];
  onSaveDoorTeam: (list: string[]) => Promise<void>;
};

/**
 * Host home for one event, laid out like Luma's Overview: quick actions, the
 * event as guests see it, then guests, hosts and links. Money replaces Luma's
 * invitations: closing the event is the one thing a host must not miss, so it
 * jumps to the top as soon as the event is over.
 */
export function Overview({ event, guests, guestNames, origin, isHost, busy, onGuests, onCheckIn, onFinalize, onCancel, doorTeam, onSaveDoorTeam }: Props) {
  const [sharing, setSharing] = useState(false);
  const id = event.id;
  const open = event.status === "Open";
  const pageUrl = origin ? `${origin}/e/${id}` : "";
  const payUrl = origin ? `${origin}/p/${id}` : "";
  const integrationHref = `/e/${id}/manage?tab=integration`;
  const over = open && Date.now() >= event.metadata.ends_at;
  // A bonded Deposit event can only be cancelled before it starts (escrow v3).
  const canCancel = open && isHost && (isTicket(event) || !event.dao || event.host_bond === "0" || Date.now() < event.metadata.starts_at);

  const closeCard = (
    <CloseEvent event={event} isHost={isHost} busy={busy} over={over} canCancel={canCancel} onFinalize={onFinalize} />
  );

  return (
    <div className="space-y-8">
      <div className="gc-host-stats" aria-label="Event overview">
        <div className="gc-host-stat"><span>Registered</span><strong>{guests.length}<small className="text-sm text-muted font-normal"> / {event.capacity}</small></strong></div>
        <div className="gc-host-stat"><span>Checked in</span><strong>{event.attended_count}</strong></div>
        <div className="gc-host-stat"><span>{isTicket(event) ? "Ticket sales" : "Deposit pool"}</span><strong>{formatUsdc(event.total_pool)}<small className="block text-xs text-muted font-normal tracking-normal">USDC</small></strong></div>
        {event.dao && !isTicket(event) && <BondStat event={event} isHost={isHost} />}
      </div>
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex sm:grid sm:grid-cols-3 gap-3 overflow-x-auto [scrollbar-width:none]">
        <QuickAction tone="accent" icon={<ShareIcon />} label="Share Event" onClick={() => setSharing(true)} />
        {open ? (
          <QuickAction tone="good" icon={<ScanIcon />} label="Check In Guests" onClick={onCheckIn} />
        ) : (
          <QuickAction tone="good" icon={<ListIcon />} label="Guest List" onClick={onGuests} />
        )}
        <QuickAction tone="amber" icon={<CodeIcon />} label="Add to Your Site" href={integrationHref} />
      </div>

      {over && closeCard}

      <section className="card p-3 sm:p-4 grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
        <div className="flex flex-col gap-3 min-w-0">
          <EventPreview event={event} pageUrl={pageUrl} />
          <ShareLinks title={event.metadata.title} url={pageUrl} />
        </div>
        <div className="flex flex-col gap-4 min-w-0 md:pt-1">
          <h2 className="text-lg font-semibold">When</h2>
          <WhenRow event={event} />
          <PriceRow event={event} />
        </div>
      </section>

      <GuestsSection event={event} guests={guests} guestNames={guestNames} isHost={isHost} onGuests={onGuests} onShare={() => setSharing(true)} />

      {!over && closeCard}

      {canCancel && <CancelEvent event={event} busy={busy} onCancel={onCancel} />}

      <Divider />
      <HostsSection event={event} isHost={isHost} doorTeam={doorTeam} onSave={onSaveDoorTeam} onGuests={onGuests} />

      <Divider />
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Registration links</h2>
          <p className="text-sm text-muted mt-0.5">Share the event page or quick checkout, or copy the button code for your site.</p>
        </div>
        <div className="card divide-y divide-border">
          <LinkRow title="Payment link" hint="A bare pay page for Instagram, WhatsApp and the like" value={payUrl} />
          <div className="flex items-center gap-3 p-3 sm:p-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Add to your site</div>
            </div>
            <Link href={integrationHref} className="btn btn-ghost !py-1.5 text-sm shrink-0">
              Open
            </Link>
          </div>
        </div>
      </section>

      {sharing && (
        <ShareDialog title={event.metadata.title} pageUrl={pageUrl} payUrl={payUrl} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

function Divider() {
  return <hr className="border-border" />;
}

/* ---------- Quick actions ---------- */

const TONES = {
  accent: "bg-accent-soft text-accent",
  good: "bg-good/15 text-good",
  amber: "bg-accent-soft text-accent",
};

function QuickAction({
  tone,
  icon,
  label,
  onClick,
  href,
}: {
  tone: keyof typeof TONES;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const className = "card shrink-0 flex items-center gap-3 p-3 pr-4 font-semibold text-sm hover:border-accent/40 transition-colors text-left";
  const body = (
    <>
      <span className={`inline-flex w-9 h-9 shrink-0 rounded-[10px] items-center justify-center ${TONES[tone]}`}>{icon}</span>
      <span className="whitespace-nowrap">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/* ---------- Event as guests see it ---------- */

function EventPreview({ event, pageUrl }: { event: EventView; pageUrl: string }) {
  const start = new Date(event.metadata.starts_at);
  return (
    <div className="relative flex-1 rounded-xl border border-border bg-bg overflow-hidden">
      <div className="flex gap-3 p-3 pb-14">
        <Cover event={event} className="aspect-square w-28 sm:w-32 shrink-0 rounded-lg [&>span]:hidden" />
        <div className="min-w-0 space-y-1.5">
          <div className="font-semibold leading-snug line-clamp-3 break-words">{event.metadata.title}</div>
          <div className="text-xs text-muted">
            {start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div className="text-xs font-medium">{priceLabel(event)}</div>
          <div className="text-xs text-muted truncate">Hosted by {shortAccount(event.host)}</div>
        </div>
      </div>
      <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-lg bg-text text-bg pl-3 pr-1 py-1 text-sm">
        <Link href={`/e/${event.id}`} target="_blank" className="flex-1 min-w-0 truncate hover:underline">
          {pageUrl.replace(/^https?:\/\//, "") || "…"}
        </Link>
        <CopyButton value={pageUrl} label="COPY" className="shrink-0 px-2 py-1 text-xs font-semibold tracking-wide opacity-80 hover:opacity-100" />
      </div>
    </div>
  );
}

function shareTargets(title: string, url: string) {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  return [
    { label: "X", href: `https://x.com/intent/post?text=${t}&url=${u}` },
    { label: "Telegram", href: `https://t.me/share/url?url=${u}&text=${t}` },
    { label: "WhatsApp", href: `https://wa.me/?text=${t}%20${u}` },
    { label: "Email", href: `mailto:?subject=${t}&body=${u}` },
  ];
}

function ShareLinks({ title, url }: { title: string; url: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
      <span className="text-sm text-muted">Share Event</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {shareTargets(title, url).map((s) => (
          <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-text">
            {s.label}
          </a>
        ))}
      </div>
    </div>
  );
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const dayMs = 86_400_000;
  const whole = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((whole(d) - whole(today)) / dayMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function WhenRow({ event }: { event: EventView }) {
  const { starts_at, ends_at } = event.metadata;
  const time = (ms: number, zone = false) =>
    new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(zone ? { timeZoneName: "short" } : {}) });
  const sameDay = new Date(starts_at).toDateString() === new Date(ends_at).toDateString();
  return (
    <div className="flex gap-3">
      <DateBadge ms={starts_at} />
      <div className="min-w-0">
        <div className="font-medium">{dayLabel(starts_at)}</div>
        <div className="text-sm text-muted">
          {time(starts_at)} – {sameDay ? "" : `${dayLabel(ends_at)}, `}
          {time(ends_at, true)}
        </div>
      </div>
    </div>
  );
}

function RowIcon({ children }: { children: ReactNode }) {
  return <span className="w-11 h-11 shrink-0 rounded-lg border border-border bg-surface inline-flex items-center justify-center text-muted">{children}</span>;
}

function PriceRow({ event }: { event: EventView }) {
  return (
    <div className="flex gap-3">
      <RowIcon>
        <CoinIcon />
      </RowIcon>
      <div className="min-w-0">
        <div className="font-medium">{priceLabel(event)}</div>
        <p className="text-sm text-muted">
          {isTicket(event)
            ? "Everyone pays the same. Each ticket goes to your balance as soon as the guest registers."
            : "Everyone puts in the same. Whoever shows up splits the pool."}
        </p>
      </div>
    </div>
  );
}

/* ---------- Guests ---------- */

function timeAgo(ms: number): string {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "Now";
  if (min < 60) return `${min}m ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function GuestsSection({ event, guests, guestNames, isHost, onGuests, onShare }: { event: EventView; guests: GuestView[]; guestNames: GuestNames; isHost: boolean; onGuests: () => void; onShare: () => void }) {
  const going = event.guest_count;
  const attended = event.attended_count;
  const capacity = Math.max(event.capacity, 1);
  const left = Math.max(event.capacity - going, 0);
  const pct = (n: number) => `${Math.min((n / capacity) * 100, 100)}%`;
  const recent = [...guests].sort((a, b) => b.registered_at - a.registered_at).slice(0, RECENT_GUESTS);
  const pool = BigInt(event.total_pool);
  const ticket = isTicket(event);
  const each = attended > 0 ? pool / BigInt(attended) : 0n;
  const open = event.status === "Open";

  return (
    <section className="space-y-5">
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Guests</h2>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="text-good font-medium">
            <span aria-hidden className="inline-block w-2 h-2 rounded-full bg-good mr-2 align-middle" />
            <span className="text-xl font-semibold">{going}</span> Going
            {attended > 0 && <span className="text-muted font-normal"> · {attended} checked in</span>}
          </div>
          <div className="text-sm text-muted">{open && Date.now() < registrationEndsAt(event) ? `${left} of ${event.capacity} spots left` : `${event.capacity} spots`}</div>
        </div>
        <div
          className="relative h-2 rounded-full bg-border overflow-hidden"
          role="img"
          aria-label={`${going} of ${event.capacity} spots taken, ${attended} checked in`}
        >
          <div className="absolute inset-y-0 left-0 bg-good/40 rounded-full" style={{ width: pct(going) }} />
          <div className="absolute inset-y-0 left-0 bg-good rounded-full" style={{ width: pct(attended) }} />
        </div>
        {going > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label={open ? (ticket ? "Ticket sales" : "Deposit pool") : "Total pool"} value={`${formatUsdc(pool)} USDC`} />
          {ticket ? (
            <Stat label="Paid to you" value={`${formatUsdc(pool)} USDC`} />
          ) : (
            <Stat
              label={open ? "Each if published now" : event.status === "Submitted" ? "Each if the list stands" : "Each attendee got"}
              value={
                (open || event.status === "Submitted") && attended > 0
                  ? `${formatUsdc(each)} USDC`
                  : event.status === "Finalized" && attended > 0
                    ? `${formatUsdc(event.payout_per_attendee)} USDC`
                    : "—"
              }
            />
          )}
          <Stat label="Checked in" value={`${attended} / ${going}`} className="col-span-2 sm:col-span-1" />
        </div>
        )}
      </div>

      <div className="space-y-3">
        {going > 0 && (
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Recent Registrations</h3>
            <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={onGuests}>
              All Guests →
            </button>
          </div>
        )}
        {recent.length > 0 ? (
          <ul className="card divide-y divide-border overflow-hidden">
            {recent.map((g) => {
              const name = guestNames[g.account_id];
              return (
              <li key={g.account_id}>
                <button type="button" onClick={onGuests} className="w-full flex items-center gap-3 px-3 sm:px-4 py-2.5 text-left hover:bg-bg transition-colors">
                  <Avatar account={g.account_id} size={36} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate" data-tooltip={g.account_id}>
                      {name || shortAccount(g.account_id)}
                    </span>
                    {name && (
                      <span className="block text-xs text-muted truncate">{shortAccount(g.account_id)}</span>
                    )}
                  </span>
                  <span className="text-right shrink-0">
                    <GuestPill event={event} guest={g} isHost={isHost} />
                    <span className="block text-xs text-muted mt-0.5">{timeAgo(g.registered_at)}</span>
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        ) : going > 0 ? (
          <div className="card p-4 text-sm text-muted">The guest list was cleared from the chain after the event closed. The totals above stay.</div>
        ) : (
          <div className="card p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <div className="font-medium text-muted">No Guests Yet</div>
              <p className="text-sm text-muted">Share the event so people can {ticket ? "buy a ticket" : "leave a deposit"}.</p>
            </div>
            {open && (
              <button type="button" className="btn btn-ghost !py-1.5 text-sm" onClick={onShare}>
                Share Event
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function GuestPill({ event, guest, isHost }: { event: EventView; guest: GuestView; isHost: boolean }) {
  const { label, tone } = guestStatus(event, guest, isHost);
  return tone === "solid"
    ? <span className="gc-chip !bg-good !text-bg">{label}</span>
    : <span className="gc-chip" data-tone={tone}>{label}</span>;
}

/** The host bond (court events): how much, and whether it is locked, back with the host, or lost. */
function BondStat({ event, isHost }: { event: EventView; isHost: boolean }) {
  const locked = BigInt(event.host_bond ?? "0") > 0n;
  const lost = (event.upheld_disputes ?? 0) > 0 || !!event.abandoned;
  const [note, tone] = !locked
    ? ["not locked", "text-warn"]
    : (event.status === "Submitted" || event.status === "Finalized") && lost
      ? ["lost", "text-warn"]
      : event.status === "Open" || event.status === "Submitted"
        ? ["locked", "text-muted"]
        : ["returned", "text-good"];
  return (
    <div className="gc-host-stat">
      <span>{isHost ? "Your bond" : "Host bond"}</span>
      <strong>
        {formatUsdc(locked ? event.host_bond! : hostBondFor(event))}
        <small className={`block text-xs font-normal tracking-normal ${tone}`}>USDC · {note}</small>
      </strong>
    </div>
  );
}

function Stat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={`card p-3 sm:p-4 min-w-0 ${className}`}>
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold tracking-tight mt-1 truncate">{value}</div>
    </div>
  );
}

/* ---------- Close / pay out ---------- */

function CloseEvent({
  event,
  isHost,
  busy,
  over,
  canCancel,
  onFinalize,
}: {
  event: EventView;
  isHost: boolean;
  busy: boolean;
  over: boolean;
  canCancel: boolean;
  onFinalize: () => void;
}) {
  const ticket = isTicket(event);
  const pool = BigInt(event.total_pool);
  const { attended_count: attended, guest_count: going } = event;
  const court = !!event.dao;
  const bonded = BigInt(event.host_bond ?? "0") > 0n;
  const submitBy = when(event.submit_by ?? event.metadata.ends_at);
  // v3: past the publish deadline only `refund` works (shown on the event page).
  const late = !ticket && !!event.submit_by && Date.now() > event.submit_by;

  if (event.status === "Open" && late) {
    return (
      <section className="card p-4 space-y-1">
        <h2 className="font-semibold text-warn">{court && going === 0 ? "Nobody registered" : "Too late to publish the list"}</h2>
        <p className="text-sm text-muted">
          {!court
            ? `The deadline was ${submitBy}. Anyone can now refund every guest.`
            : going === 0
              ? `Anyone can close the event now.${bonded ? " Your bond goes back to your balance." : ""}`
              : `The deadline was ${submitBy}. Anyone can now start the refund on the event page. Your bond is lost; guests who came can still prove it.`}
        </p>
      </section>
    );
  }
  if (event.status === "Finalized") {
    return (
      <section className="card p-4 space-y-1">
        <h2 className="font-semibold text-good">Paid out</h2>
        <p className="text-sm text-muted">
          {ticket
            ? `${formatUsdc(pool)} USDC from tickets went to the host.`
            : attended > 0
              ? `${attended} of ${going} came. Each got ${formatUsdc(event.payout_per_attendee)} USDC, ready to withdraw.`
              : "Nobody was checked in, so every deposit went back to its guest."}
        </p>
      </section>
    );
  }
  // The "Who came" panel at the top of Overview covers the published list, disputes and the bond.
  if (event.status === "Submitted") return null;
  if (event.status === "Refunded") {
    return (
      <section className="card p-4 space-y-1">
        <h2 className="font-semibold">Closed</h2>
        <p className="text-sm text-muted">Nobody registered and no list was published, so the event closed. Your bond went back to your balance.</p>
      </section>
    );
  }
  if (event.status === "Cancelled") {
    return (
      <section className="card p-4 space-y-1">
        <h2 className="font-semibold text-warn">Cancelled</h2>
        <p className="text-sm text-muted">{ticket ? "Ticket money stays with the host." : "Every deposit was refunded. Guests can withdraw it from their balance."}</p>
      </section>
    );
  }

  const each = attended > 0 ? formatUsdc(pool / BigInt(attended)) : "0";
  const started = Date.now() >= event.metadata.starts_at;
  const summary = ticket
    ? `${formatUsdc(pool)} USDC from ${going} ${going === 1 ? "ticket" : "tickets"} is already in your balance.${over ? "" : " Close the event after it ends."}`
    : !over
      ? `${attended > 0 ? `${attended} of ${going} checked in so far. ` : ""}After the event, publish who came by ${submitBy}.${court ? ` Guests then have ${windowText(event)} to dispute it.` : " The list is final."}${court && bonded && started && !canCancel ? " The event has started, so it can’t be cancelled." : ""}`
      : attended > 0
        ? court
          ? `${attended} of ${going} checked in. Publish by ${submitBy}. If nobody disputes it within ${windowText(event)}, ${formatUsdc(pool)} USDC is split: ${each} USDC each.`
          : `${attended} of ${going} checked in. Publish by ${submitBy} to pay out ${formatUsdc(pool)} USDC now: ${each} USDC each. The list is final.`
        : going > 0
          ? "Nobody is checked in. If you publish an empty list, every deposit goes back to its guest."
          : `Nobody registered. Publish the empty list to close the event${bonded ? " and get your bond back" : ""}.`;

  return (
    <section className={`card p-4 space-y-3 ${over ? "ring-2 ring-accent" : ""}`}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="font-semibold">{over ? (ticket ? "The event is over. Close it to get paid." : "The event is over. Publish who came.") : ticket ? "Get paid" : "Publish who came"}</h2>
          {/* Before the end there is nothing to press: say when it opens instead of showing a disabled button. */}
          {!over && isHost && <span className="gc-chip">Opens {soon(event.metadata.ends_at)}</span>}
        </div>
        <p className="text-sm text-muted mt-0.5">{summary}</p>
      </div>
      {isHost ? (
        over && (
          <button type="button" className="btn btn-accent w-full sm:w-auto" disabled={busy} onClick={onFinalize}>
            {ticket ? "Close Event & Get Paid" : "Publish Who Came"}
          </button>
        )
      ) : (
        <p className="text-sm text-muted">Only the host ({shortAccount(event.host)}) can {ticket ? "close the event" : "publish who came"}. You can check guests in.</p>
      )}
    </section>
  );
}

/* ---------- Cancel ---------- */

/** Host only, while open. Deposits and the host bond come back in the same call; tickets are not refunded. */
function CancelEvent({ event, busy, onCancel }: { event: EventView; busy: boolean; onCancel: () => void }) {
  return (
    <section className="card p-4 space-y-3 border-warn/40">
      <div>
        <h2 className="font-semibold">Cancel event</h2>
        <p className="text-sm text-muted mt-0.5">{cancelText(event)}</p>
      </div>
      <button type="button" className="btn btn-ghost !py-2 text-sm text-warn border-warn/50 hover:bg-warn/10" disabled={busy} onClick={onCancel}>
        {isTicket(event) || event.guest_count === 0 ? "Cancel Event" : "Cancel Event & Refund"}
      </button>
    </section>
  );
}

/** What cancelling does to the money; also the confirm text in Manage. */
export function cancelText(event: EventView): string {
  const n = event.guest_count;
  const pool = formatUsdc(event.total_pool);
  if (isTicket(event)) {
    return `${n > 0 ? `Guests are not refunded: the ${pool} USDC from tickets stays in your balance.` : "Nobody has bought a ticket yet."} This cannot be undone.`;
  }
  const bond = BigInt(event.host_bond ?? "0") > 0n;
  return `${n > 0
    ? `Every guest gets the deposit back: ${n} ${n === 1 ? "deposit" : "deposits"} (${pool} USDC) go to their Nearvent balances${bond ? ", and your bond comes back to you" : ""}.`
    : `Nobody has paid yet.${bond ? " Your bond comes back to you." : ""}`} This cannot be undone.`;
}

/* ---------- Hosts ---------- */

function HostsSection({ event, isHost, doorTeam, onSave, onGuests }: {
  event: EventView;
  isHost: boolean;
  doorTeam: string[];
  onSave: (list: string[]) => Promise<void>;
  onGuests: () => void;
}) {
  const open = event.status === "Open";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const problem = cohostsProblem(text);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      await onSave(splitCohosts(text));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Hosts</h2>
          <p className="text-sm text-muted mt-0.5">The door team can check guests in. Only the host can publish the list or cancel.</p>
        </div>
        {isHost && open && !editing && (
          <button type="button" className="btn btn-ghost !py-1.5 text-sm shrink-0" onClick={() => { setText(doorTeam.join(", ")); setError(null); setEditing(true); }}>
            Edit Door Team
          </button>
        )}
      </div>
      <ul className="card divide-y divide-border overflow-hidden">
        <HostRow account={event.host} badge="Host" />
        {doorTeam.map((a) => (
          <HostRow key={a} account={a} badge="Door team" />
        ))}
      </ul>
      {editing && (
        <div className="card p-3 sm:p-4 space-y-2">
          <label className="block space-y-1 text-sm">
            <span>NEAR accounts or 0x addresses that can check guests in, separated by commas</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="alice.near, bob.near" />
          </label>
          {error && <p role="alert" className="text-sm text-warn break-words">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary !py-1.5 text-sm" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-ghost !py-1.5 text-sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <button type="button" className="text-sm text-muted hover:text-text inline-flex items-center gap-1.5" onClick={onGuests}>
        <ScanIcon size={14} /> {open ? "Open check-in and the guest list" : "Open the guest list"}
      </button>
    </section>
  );
}

function HostRow({ account, badge }: { account: string; badge: string }) {
  return (
    <li className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
      <Avatar account={account} size={28} />
      <span className="font-medium truncate min-w-0" data-tooltip={account}>
        {shortAccount(account)}
      </span>
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent shrink-0">{badge}</span>
    </li>
  );
}

/* ---------- Links ---------- */

function LinkRow({ title, hint, value }: { title: string; hint: string; value: string }) {
  return (
    <div className="flex items-center gap-3 p-3 sm:p-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted mt-0.5 truncate">{value.replace(/^https?:\/\//, "") || hint}</div>
      </div>
      <CopyButton value={value} label="Copy" className="btn btn-ghost !py-1.5 text-sm shrink-0" />
    </div>
  );
}

function CopyButton({ value }: { value: string; label?: string; className?: string }) {
  return value ? <SlCopy text={value} /> : null;
}

function ShareDialog({ title, pageUrl, payUrl, onClose }: { title: string; pageUrl: string; payUrl: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="share-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="card m-auto w-[calc(100%-2rem)] max-w-md p-0 text-text backdrop:bg-black/40"
    >
      <div className="p-5 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <span className={`inline-flex w-11 h-11 rounded-full items-center justify-center ${TONES.accent}`}>
              <ShareIcon />
            </span>
            <h2 id="share-title" className="text-lg font-semibold">
              Share This Event
            </h2>
          </div>
          <button type="button" aria-label="Close" className="text-muted hover:text-text text-xl leading-none px-1" onClick={() => ref.current?.close()}>
            ×
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {shareTargets(title, pageUrl).map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noreferrer" className="btn btn-ghost !py-2 !px-2 text-sm">
              {s.label}
            </a>
          ))}
        </div>
        <hr className="border-border" />
        <DialogLink label="Share the link" value={pageUrl} />
        <DialogLink label="Or send the payment page" value={payUrl} />
      </div>
    </dialog>
  );
}

function DialogLink({ label, value }: { label: string; value: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="flex gap-2">
        <input readOnly value={value} className="input !py-2 text-sm" onFocus={(e) => e.currentTarget.select()} />
        <CopyButton value={value} label="Copy" className="btn btn-ghost !py-2 text-sm shrink-0" />
      </span>
    </label>
  );
}

/* ---------- Icons (Lucide shapes, inline to avoid a new dependency) ---------- */

function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}
const ShareIcon = () => (
  <Icon>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </Icon>
);
const ScanIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" />
  </Icon>
);
const ListIcon = () => (
  <Icon>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </Icon>
);
const CodeIcon = () => (
  <Icon>
    <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
  </Icon>
);
const PinIcon = () => (
  <Icon>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </Icon>
);
const AlertIcon = () => (
  <Icon>
    <path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3ZM12 9v4M12 17h.01" />
  </Icon>
);
const CoinIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 9.5C15 8.1 13.7 7 12 7s-3 1.1-3 2.5S10.3 12 12 12s3 1.1 3 2.5-1.3 2.5-3 2.5-3-1.1-3-2.5" />
  </Icon>
);
