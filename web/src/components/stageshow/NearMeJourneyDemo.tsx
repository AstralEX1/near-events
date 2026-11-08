"use client";

import { useEffect, useState } from "react";
import {
  Stage,
  Swap,
  Window,
  type Act,
  type LookTokens,
} from "./kit";
import { Avatar, DateBadge, StatusPill } from "@/components/ui";
import { EventPoster, VisualBackdrop } from "@/components/EventVisual";
import "./kit/stageshow.css";
import "./near-me-journey.css";

type Journey = { phase: number };
type Theme = "light" | "dark";

const INITIAL: Journey = { phase: 0 };
const FINAL: Journey = { phase: 5 };
const EVENT_START = new Date("2026-11-14T16:00:00+08:00").getTime();
const EVENT_VISUAL = { themeId: "paradise", seed: 2 } as const;

const TOKENS: LookTokens = {
  "--ss-canvas": "var(--bg)",
  "--ss-surface": "var(--surface)",
  "--ss-chrome": "var(--surface)",
  "--ss-raised": "var(--surface)",
  "--ss-text": "var(--muted)",
  "--ss-text-faint": "var(--muted)",
  "--ss-text-strong": "var(--text)",
  "--ss-ink-1": "color-mix(in srgb, var(--text) 4%, transparent)",
  "--ss-ink-2": "color-mix(in srgb, var(--text) 6%, transparent)",
  "--ss-ink-3": "color-mix(in srgb, var(--text) 8%, transparent)",
  "--ss-ink-4": "color-mix(in srgb, var(--text) 11%, transparent)",
  "--ss-ink-5": "color-mix(in srgb, var(--text) 17%, transparent)",
  "--ss-fill": "color-mix(in srgb, var(--surface) 92%, var(--text))",
  "--ss-accent": "var(--accent)",
  "--ss-accent-soft": "var(--accent-soft)",
  "--ss-accent-text": "var(--accent)",
  "--ss-success": "var(--good)",
  "--ss-success-soft": "color-mix(in srgb, var(--good) 14%, transparent)",
  "--ss-success-text": "var(--good)",
  "--ss-line": "var(--border)",
  "--ss-line-faint": "color-mix(in srgb, var(--border) 65%, transparent)",
  "--ss-radius-sm": "8px",
  "--ss-radius-md": "12px",
  "--ss-radius-lg": "16px",
  "--ss-radius-window": "16px",
  "--ss-font": "var(--font-geist-sans), system-ui, sans-serif",
};

const CURSOR_REST = {
  wide: { x: 850, y: 580 },
  compact: { x: 338, y: 650 },
};

const story = async (a: Act<Journey>) => {
  await a.wait(600);
  a.mark("register");
  await a.click("join");
  a.put({ phase: 1 });
  await a.move(CURSOR_REST, { duration: 420 });
  a.mark("pass");

  await a.wait(2500);
  a.mark("check-in");
  a.put({ phase: 1.5 });
  await a.wait(600);
  a.put({ phase: 2 });
  await a.wait(650);
  a.mark("check-in-click");
  await a.click("check-in");
  a.put({ phase: 3 });

  await a.wait(2300);
  a.mark("closeout");
  a.put({ phase: 3.5 });
  await a.wait(600);
  a.put({ phase: 4 });
  await a.wait(500);
  a.mark("close");
  await a.click("close");
  a.put({ phase: 5 });
  await a.move(CURSOR_REST, { duration: 420 });
  a.mark("payout");
  await a.wait(2600);
};

function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(preference.matches ? "dark" : "light");
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  return theme;
}

export function NearMeJourneyDemo() {
  const [run, setRun] = useState(0);
  const [mounted, setMounted] = useState(false);
  const theme = useSystemTheme();

  useEffect(() => setMounted(true), []);

  return (
    <section id="near-me-journey" className="nm-journey" aria-label="Near Me event journey">
      <div className="nm-journey__toolbar">
        <button
          type="button"
          className="nm-journey__replay"
          aria-label="Replay demo"
          onClick={() => setRun((value) => value + 1)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4.2 7.1A6.2 6.2 0 1 1 4 12.5M4.2 7.1V3.8m0 3.3h3.3" />
          </svg>
        </button>
      </div>
      <div className="nm-journey__stage" aria-hidden="true">
        {mounted && <JourneyStage key={run} theme={theme} />}
      </div>
    </section>
  );
}

function JourneyStage({ theme }: { theme: Theme }) {
  return (
    <Stage<Journey>
      width={880}
      height={600}
      compact={{ below: 620, width: 358, height: 682 }}
      initial={INITIAL}
      poster={FINAL}
      play="once"
      script={story}
      cursor={{
        at: {
          wide: { x: 632, y: 350 },
          compact: { x: 188, y: 430 },
        },
        kind: "pointer",
        style: "arrow",
        ripple: true,
      }}
      theme={theme}
      palette="accent"
      fidelity="realistic"
      tokens={TOKENS}
      className="nm-journey__canvas"
    >
      {(s, _rect, layout) => {
        const compact = layout === "compact";
        return (
          <>
            <div className="nm-journey__ground" />
            <Window
              url="near.events/e/4"
              className="nm-journey__window"
              style={
                compact
                  ? { left: 0, top: 12, width: 358, height: 658 }
                  : { left: 0, top: 36, width: 880, height: 530 }
              }
            >
              <AppScreen phase={s.phase} compact={compact} />
            </Window>
          </>
        );
      }}
    </Stage>
  );
}

function AppScreen({ phase, compact }: { phase: number; compact: boolean }) {
  return (
    <div className="nm-screen-deck">
      {phase < 2 && (
        <GuestEventPage
          key="guest"
          phase={Math.min(phase, 1)}
          compact={compact}
          exiting={phase > 1}
        />
      )}
      {phase >= 1.5 && phase < 4 && (
        <HostGuestList
          key="guests"
          phase={phase >= 3 ? 3 : 2}
          compact={compact}
          exiting={phase > 3}
        />
      )}
      {phase >= 3.5 && phase < 5 && (
        <HostCloseout key="closeout" phase={phase >= 4 ? 4 : 3.5} compact={compact} />
      )}
      {phase >= 5 && <GuestPayout key="payout" compact={compact} />}
    </div>
  );
}

function AppHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className="nm-site-header">
      <div className="nm-site-header__inner">
        <div className="nm-brand">
          <span className="nm-brand__mark">N</span>
          <span>Near Me</span>
        </div>
        <span className="nm-network">testnet</span>
        <nav className="nm-site-nav" aria-label="Main navigation">
          {!compact && <span>Events</span>}
          <span>Create</span>
          <span>Integrate</span>
          <span className="nm-signin">Sign in</span>
        </nav>
      </div>
    </header>
  );
}

function GuestEventPage({
  phase,
  compact,
  exiting = false,
}: {
  phase: number;
  compact: boolean;
  exiting?: boolean;
}) {
  return (
    <div className="nm-browser-screen" data-compact={compact || undefined} data-exiting={exiting || undefined}>
      <AppHeader compact={compact} />
      <main className="nm-site-main">
        <VisualBackdrop visual={EVENT_VISUAL} className="nm-event-backdrop">
            <div className="nm-event-layout-inner">
              <aside className="nm-event-aside">
                <EventPoster title="Sunset Sessions" visual={EVENT_VISUAL} className="nm-event-cover" />
                <div className="nm-event-aside-block">
                  <div className="nm-section-label">Hosted by</div>
                  <div className="nm-account-row">
                    <Avatar account="maya.rahman.near" size={24} />
                    <span>maya.rahman.near</span>
                  </div>
                </div>
                <div className="nm-event-aside-block">
                  <div className="nm-section-label">15 going</div>
                  <div className="nm-avatar-stack">
                    <Avatar account="kai.mori.near" size={28} />
                    <Avatar account="mina.lee.near" size={28} />
                    <Avatar account="noah.park.near" size={28} />
                    <span>+12</span>
                  </div>
                </div>
              </aside>

              <section className="nm-event-content">
                <div className="nm-event-title-row">
                  <div className="nm-event-title-copy">
                    {phase >= 5 && <StatusPill status="Finalized" />}
                    <h1>Sunset Sessions</h1>
                  </div>
                  <button type="button" className="nm-more" aria-label="More options">•••</button>
                </div>

                <div className="nm-event-facts">
                  <div className="nm-date-row">
                    <DateBadge ms={EVENT_START} />
                    <div className="nm-date-copy">
                      <span>Saturday, November 14 · 4:00 PM – 7:00 PM</span>
                      <span className="nm-muted">GMT+8 · Bali</span>
                    </div>
                  </div>
                  <p className="nm-deposit-summary">10 USDC deposit · pool 150 USDC</p>
                </div>

                {phase >= 5 ? (
                  <div className="card overflow-hidden bg-surface/80">
                    <div className="nm-registration-heading">Registration</div>
                    <div className="nm-registration-body nm-payout-copy">
                      <p>You showed up. 10 of 15 came. You have <strong>15 USDC</strong>.</p>
                      <button type="button" className="btn btn-accent w-full" aria-label="Withdraw 15 USDC">Withdraw 15 USDC</button>
                      <p className="text-xs text-muted">Ready to withdraw from your Near Me balance.</p>
                    </div>
                  </div>
                ) : (
                  <div className="card overflow-hidden bg-surface/80">
                    <div className="nm-registration-heading">Registration</div>
                    <div className="nm-registration-body">
                      {phase < 1 ? (
                        <>
                          <button type="button" className="btn btn-accent w-full !py-3.5" data-target="join">
                            Join · 10 USDC
                          </button>
                          <p className="nm-registration-note">Come and get your deposit back plus a share of the no-shows.</p>
                        </>
                      ) : (
                        <div className="nm-next-steps">
                          <img className="nm-qr" src="/near-me-demo-qr.svg" alt="" />
                          <div>
                            <h2>You’re going</h2>
                            <p className="nm-registration-note">Show this code at the door to get checked in.</p>
                            <button type="button" className="nm-text-action">Add to calendar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </VisualBackdrop>
        </main>
        <SiteFooter compact={compact} />
      </div>
    );
}

function HostHeader({ compact }: { compact: boolean }) {
  return <AppHeader compact={compact} />;
}

function ManageHeading() {
  return (
    <div className="nm-manage-heading">
      <div>
        <p className="nm-breadcrumb">Events <span>›</span> Manage</p>
        <div className="nm-manage-title-row">
          <h1>Sunset Sessions</h1>
        </div>
      </div>
      <button type="button" className="btn btn-ghost !py-2 text-sm">Event Page ↗</button>
    </div>
  );
}

function ManageTabs({ selected }: { selected: "overview" | "guests" }) {
  return (
    <nav className="nm-manage-tabs" aria-label="Manage sections">
      <span data-selected={selected === "overview" || undefined}>Overview</span>
      <span>Event page</span>
      <span data-selected={selected === "guests" || undefined}>Guests</span>
      <span>Registration</span>
      <span>Integration</span>
    </nav>
  );
}

function HostGuestList({ phase, compact, exiting = false }: { phase: number; compact: boolean; exiting?: boolean }) {
  const checkedIn = phase >= 3;
  return (
    <div className="nm-browser-screen" data-compact={compact || undefined} data-exiting={exiting || undefined}>
      <HostHeader compact={compact} />
      <main className="nm-site-main nm-manage-main">
        <ManageHeading />
        <ManageTabs selected="guests" />
        <section className="nm-manage-summary">
          <div>
            <span className="nm-manage-eyebrow">At a Glance</span>
            <h2>15 Going <span>·</span> <Swap id={checkedIn ? "ten-in" : "nine-in"}>{checkedIn ? "10" : "9"}</Swap> in</h2>
            {!compact && <p>~15 USDC each if you close now</p>}
          </div>
          <button type="button" className="btn btn-ghost nm-scan-button">Scan QR codes</button>
        </section>
        <section className="nm-guest-list">
          <div className="nm-guest-list__header">
            <h2>Guest List</h2>
            <span>15 registered</span>
          </div>
          <div className="nm-guest-row" data-focused={!checkedIn || undefined}>
            <Avatar account="kai.mori.near" size={36} />
            <div className="nm-guest-row__copy">
              <strong>kai.mori.near</strong>
              <span><Swap id={checkedIn ? "kai-checked" : "kai-going"}>{checkedIn ? "Checked in" : "Paid · going"}</Swap></span>
            </div>
            {checkedIn ? (
              <span className="nm-checked-pill">✓ In</span>
            ) : (
              <button type="button" className="btn btn-ghost !py-2 !px-3 text-sm" data-target="check-in">Check in</button>
            )}
          </div>
          <div className="nm-guest-row">
            <Avatar account="mina.lee.near" size={36} />
            <div className="nm-guest-row__copy"><strong>mina.lee.near</strong><span>Checked in</span></div>
            <span className="nm-checked-pill">✓ In</span>
          </div>
          <div className="nm-guest-row">
            <Avatar account="noah.park.near" size={36} />
            <div className="nm-guest-row__copy"><strong>noah.park.near</strong><span>Checked in</span></div>
            <span className="nm-checked-pill">✓ In</span>
          </div>
          {!compact && <div className="nm-guest-list__foot">15 registered · {checkedIn ? "10" : "9"} attending</div>}
        </section>
      </main>
      <SiteFooter compact={compact} />
    </div>
  );
}

function HostCloseout({ phase, compact }: { phase: number; compact: boolean }) {
  const closed = phase >= 4;
  return (
    <div className="nm-browser-screen" data-compact={compact || undefined}>
      <HostHeader compact={compact} />
      <main className="nm-site-main nm-manage-main">
        <ManageHeading />
        <ManageTabs selected="overview" />
        <section className="nm-closeout-summary">
          <div className="nm-manage-eyebrow">At a Glance</div>
          <h2>15 Going <span>· 10 in</span></h2>
          <p>~15 USDC each if you close now</p>
        </section>
        <section className="card nm-closeout-card">
          <div>
            <h2>{closed ? "Event closed" : "The event is over. Close it to pay out."}</h2>
            <p>10 of 15 checked in. Closing splits 150 USDC: 15 USDC each.</p>
          </div>
          <button type="button" className="btn btn-accent" data-target="close">
            {closed ? "Event closed" : "Close event & pay out"}
          </button>
        </section>
      </main>
      <SiteFooter compact={compact} />
    </div>
  );
}

function GuestPayout({ compact }: { compact: boolean }) {
  return <GuestEventPage phase={5} compact={compact} />;
}

function SiteFooter({ compact }: { compact: boolean }) {
  return (
    <footer className="nm-site-footer">
      <span>Near Me · no fee</span>
      {!compact && <><span>How it works</span><span>Events</span><span>Create event</span><span>Integrate</span></>}
    </footer>
  );
}
