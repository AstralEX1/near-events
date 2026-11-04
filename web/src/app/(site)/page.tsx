"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { events, type EventView, formatUsdc } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = BOT ? `https://t.me/${BOT}` : "/create";
const INTENTS_URL = "https://near.org/intents";

/**
 * Organizer ICP (Feevent / reli) + product frames from docs/mockups-kickback.
 * Visual = real product chrome (register → door QR → withdraw), not AI art.
 */
export default function Landing() {
  const [open, setOpen] = useState<EventView[]>([]);

  useEffect(() => {
    events
      .list()
      .then((list) => setOpen(list.filter((e) => e.status === "Open").slice(0, 4)))
      .catch(() => {});
  }, []);

  const create = BOT ? (
    <a href={CREATE} className="btn btn-primary !rounded-full !px-6 !py-3">
      Fill your next event
    </a>
  ) : (
    <Link href="/create" className="btn btn-primary !rounded-full !px-6 !py-3">
      Fill your next event
    </Link>
  );

  return (
    <div className="pb-16">
      <section className="relative min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center text-center px-2 py-10">
        <div className="relative z-[1] w-full max-w-4xl mx-auto space-y-10">
          <div className="space-y-5">
            <p className="text-sm font-medium text-muted tracking-wide">Near Events</p>
            <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight leading-[1.02]">
              Turn sign-ups
              <br />
              into show-ups.
            </h1>
            <p className="text-lg sm:text-xl text-muted max-w-lg mx-auto">
              A small refundable deposit. Who comes gets it back — plus a share of the no-shows.
            </p>
          </div>

          <ProductFrames />

          <div className="flex flex-col items-center gap-3">
            {create}
            <Link href="/guide" className="text-sm text-muted hover:text-text">
              How it works →
            </Link>
            <PoweredByIntents />
          </div>
        </div>
      </section>

      <p className="text-center text-sm text-muted pb-16">
        Free RSVP ~50% no-show · with a deposit ~10% · $0 fee · you never hold the money
      </p>

      {open.length > 0 && (
        <section className="space-y-6">
          <h2 className="text-sm font-medium text-muted text-center tracking-wide uppercase">Live events</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {open.map((e) => (
              <Link
                key={e.id}
                href={`/e/${e.id}`}
                className="card p-4 text-left hover:border-accent/40 transition-colors"
              >
                <div className="font-semibold truncate">{e.metadata.title}</div>
                <div className="text-sm text-muted mt-1">
                  {formatUsdc(e.deposit)} USDC · {e.guest_count}/{e.capacity} going
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Three frames from the Kickback mockups: register → door QR → withdraw. */
function ProductFrames() {
  return (
    <div className="grid sm:grid-cols-3 gap-3 sm:gap-4 text-left max-w-4xl mx-auto">
      <Frame label="1 · Register" caption="Lock the same USDC from any chain">
        <div className="space-y-3">
          <div className="aspect-[16/10] rounded-xl bg-[#2a2163] relative overflow-hidden">
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(circle at 25% 30%, #8b7fff, transparent 55%), radial-gradient(circle at 80% 70%, #ff9d6b, transparent 50%)",
              }}
            />
          </div>
          <div className="text-xs text-muted">Fri, Nov 14 · 9:00 · arrive by 9:30</div>
          <div className="font-semibold text-[15px] leading-snug">NEAR Builders Breakfast</div>
          <div className="text-xs text-muted">Hosted by builders DAO · Lisbon</div>
          <button
            type="button"
            tabIndex={-1}
            className="w-full h-11 rounded-xl bg-accent text-white text-sm font-bold pointer-events-none"
          >
            Register · 10 USDC
          </button>
          <p className="text-[11px] text-muted leading-snug">
            Come and get it back plus a share of the no-shows.
          </p>
        </div>
      </Frame>

      <Frame label="2 · Show up" caption="Host scans your door code">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-good">
            <span className="inline-flex w-5 h-5 rounded-full bg-good/15 text-good items-center justify-center text-[11px]">
              ✓
            </span>
            Deposit locked · 10 USDC
          </div>
          <div className="font-bold text-lg">You&apos;re going</div>
          <div className="flex gap-3 items-center">
            <FakeQr />
            <p className="text-xs text-muted leading-snug">
              Show this code at the door before 9:30. Once checked in, deposit comes back + a share.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-bg/60 px-3 py-2 text-xs space-y-1">
            <div className="font-medium">Café Lumen · Príncipe Real</div>
            <div className="text-muted">Address unlocked for guests</div>
          </div>
        </div>
      </Frame>

      <Frame label="3 · Get paid" caption="Deposit back + no-shows&apos; share">
        <div className="space-y-3">
          <div className="text-xs font-semibold text-good">You showed up!</div>
          <div className="text-3xl font-bold tracking-tight">18.89 USDC</div>
          <p className="text-[11px] text-muted leading-snug">
            Your 10 USDC + share of no-shows + sponsor bonus. 9 of 12 came.
          </p>
          <button
            type="button"
            tabIndex={-1}
            className="w-full h-11 rounded-xl bg-good text-white text-sm font-bold pointer-events-none"
          >
            Withdraw payout · 18.89 USDC
          </button>
          <div className="flex flex-wrap gap-1.5">
            {["To any chain", "To another address", "Next event"].map((t) => (
              <span
                key={t}
                className="text-[10px] font-medium px-2 py-1 rounded-lg border border-border text-muted"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-muted font-mono">via NEAR Intents</p>
        </div>
      </Frame>
    </div>
  );
}

function Frame({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-sm overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-border bg-bg/70 flex items-center gap-2">
        <span className="flex gap-1" aria-hidden>
          <span className="w-2 h-2 rounded-full bg-border" />
          <span className="w-2 h-2 rounded-full bg-border" />
          <span className="w-2 h-2 rounded-full bg-border" />
        </span>
        <span className="text-[11px] font-semibold text-muted truncate">{label}</span>
      </div>
      <div className="p-3 sm:p-4 flex-1">{children}</div>
      <div className="px-3 pb-3 text-[11px] text-muted">{caption}</div>
    </div>
  );
}

/** Decorative QR pattern matching the minimal mockup (not a real payload). */
function FakeQr() {
  const cells: boolean[] = [];
  for (let r = 0; r < 21; r++) {
    for (let c = 0; c < 21; c++) {
      let on = (r * 7 + c * 13 + r * c) % 5 < 2;
      for (const [r0, c0] of [
        [0, 0],
        [0, 14],
        [14, 0],
      ] as const) {
        if (r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7) {
          const rr = r - r0;
          const cc = c - c0;
          on = rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
        }
      }
      cells.push(on);
    }
  }
  return (
    <div
      role="img"
      aria-label="Check-in QR code"
      className="w-[88px] h-[88px] shrink-0 grid grid-cols-[repeat(21,minmax(0,1fr))] border border-border rounded-lg p-1 bg-white"
    >
      {cells.map((on, i) => (
        <span key={i} style={{ background: on ? "#16161a" : "transparent" }} />
      ))}
    </div>
  );
}

function PoweredByIntents() {
  return (
    <a
      href={INTENTS_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-xs text-muted hover:text-text pt-2"
    >
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#00EC97] text-black text-[10px] font-bold">
        N
      </span>
      Powered by NEAR Intents
    </a>
  );
}
