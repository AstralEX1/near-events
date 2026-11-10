"use client";

// SL UI Library components wired to Nearvent. Each one renders the library's source markup and
// mounts its original controller; colors and sizes are adapted in SlUi.css.
// Sources (component ID / variant): matte-toast-feedback / toast-feedback (also skeleton-feedback,
// identical controller and CSS), matte-copy / copy, matte-share / share, matte-confirm-overlay /
// confirm-overlay (React adapter, Shadow DOM), matte-buttons-review-decision-v11, matte-amount-input /
// amount-input, matte-avatars-display / avatars-display.
import { useEffect, useRef, useState, type ComponentType, type RefObject } from "react";
import "./sl-ui/toast/buttons.css";
import "./sl-ui/copy/buttons.css";
import "./sl-ui/share/buttons.css";
import "./sl-ui/review-decision/buttons.css";
import "./sl-ui/amount/buttons.css";
import "./sl-ui/avatars/buttons.css";
import "./SlUi.css";
import ConfirmComponent from "./sl-ui/confirm/Component.jsx";
import { Avatar, shortAccount } from "./ui";

type Destroyable = { destroy(): void };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = (name: string) => (window as any)[name];

/** Loads a library controller (a browser script that sets a window global) and mounts it once. */
function useSl<C extends Destroyable>(load: () => Promise<unknown>, mount: (el: HTMLElement) => C): [RefObject<HTMLElement | null>, RefObject<C | null>] {
  const ref = useRef<HTMLElement | null>(null);
  const ctl = useRef<C | null>(null);
  const mountRef = useRef(mount);
  mountRef.current = mount;
  useEffect(() => {
    let alive = true;
    void load().then(() => {
      if (alive && ref.current) ctl.current = mountRef.current(ref.current);
    });
    return () => {
      alive = false;
      ctl.current?.destroy();
      ctl.current = null;
    };
    // Mount once; props reach the controller through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [ref, ctl];
}

// @ts-expect-error -- side-effect scripts with no exports
const loadFeedback = () => import("./sl-ui/toast/buttons.js");

// ---------------------------------------------------------------- toast

type Tone = "success" | "error" | "info";
/** Shows one short status message at the bottom of the screen. */
export function toast(title: string, detail = "", tone: Tone = "success") {
  window.dispatchEvent(new CustomEvent("nv:toast", { detail: { title, detail, tone } }));
}

type Feedback = Destroyable & { show(m: { title: string; detail: string; tone: Tone }): boolean };

/** Mounted once in the root layout; `toast()` talks to it. */
export function ToastHost() {
  const [ref, ctl] = useSl<Feedback>(loadFeedback, (el) => lib("MatteFeedback").mount(el, { timeout: 3500 }));
  useEffect(() => {
    const on = (e: Event) => ctl.current?.show((e as CustomEvent).detail);
    window.addEventListener("nv:toast", on);
    return () => window.removeEventListener("nv:toast", on);
  }, [ctl]);
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="fb-demo nv-toast" data-feedback="toast" tabIndex={-1}>
      <div className="fb-scene">
        <div className="fb-card fb-message fb-reveal" data-panel="" data-visible="false" aria-hidden="true" inert>
          <span className="fb-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6" /></svg></span>
          <div className="fb-copy"><h3 data-title="">Changes saved</h3><p data-detail="" /></div>
          <button className="fb-close" type="button" data-action="dismiss" aria-label="Dismiss notification"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
        </div>
      </div>
      <span className="fb-sr" data-live="" role="status" aria-live="polite" aria-atomic="true" />
      <span className="fb-sr" data-error="" role="alert" aria-atomic="true" />
    </div>
  );
}

// ---------------------------------------------------------------- skeleton

/** Same-size placeholder while an event loads. */
export function PageSkeleton() {
  const [ref] = useSl<Feedback>(loadFeedback, (el) => lib("MatteFeedback").mount(el));
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="fb-demo nv-skeleton" data-feedback="skeleton" tabIndex={-1}>
      <div className="fb-scene">
        <div className="fb-card fb-skeleton-card" data-content="" aria-busy="true">
          <div className="fb-skeleton" aria-hidden="true">
            <div className="fb-skel-top"><div className="fb-skel-avatar" /><div className="fb-skel-title"><div className="fb-skel-line" style={{ width: "62%" }} /><div className="fb-skel-line" style={{ width: "40%", height: 6 }} /></div></div>
            <div className="fb-skel-body"><div className="fb-skel-line" /><div className="fb-skel-line" style={{ width: "86%" }} /></div>
            <div className="fb-skel-bottom"><div className="fb-skel-line" /><div className="fb-skel-line" /></div>
          </div>
          <div className="fb-loaded" data-loaded="" aria-hidden="true" inert>
            <div className="fb-loaded-top"><span className="fb-icon"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5" /></svg></span><div><h3>Event</h3><p>Loaded</p></div></div>
          </div>
        </div>
      </div>
      <span className="fb-sr" data-live="" role="status" aria-live="polite" aria-atomic="true">Loading event…</span>
      <span className="fb-sr" data-error="" role="alert" aria-atomic="true" />
    </div>
  );
}

// ---------------------------------------------------------------- copy

/** Copies `text`; shows Copied only after the browser confirms the write. */
export function SlCopy({ text, className = "" }: { text: string; className?: string }) {
  const latest = useRef(text);
  latest.current = text;
  const feedback = useRef<HTMLSpanElement>(null);
  const [ref] = useSl<Destroyable>(
    // @ts-expect-error -- side-effect script with no exports
    () => import("./sl-ui/copy/buttons.js"),
    (el) => lib("MatteCopy").mount(el, { getText: () => latest.current, feedback: feedback.current, holdMs: 1500 }),
  );
  return (
    <span className={`nv-copy ${className}`}>
      <button ref={ref as RefObject<HTMLButtonElement>} className="sl-copy" type="button" aria-label="Copy text" data-state="idle" disabled>
        <span className="sl-copy__surface" aria-hidden="true">
          <span className="sl-copy__wash" />
          <span className="sl-copy__icon">
            <svg className="sl-copy__sheets" viewBox="0 0 24 24" fill="none" focusable="false"><rect className="sl-copy__back" x="3.5" y="3.5" width="12" height="14" rx="3" /><rect className="sl-copy__front" x="8.5" y="7.5" width="12" height="14" rx="3" /></svg>
            <svg className="sl-copy__check" viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4 12.5 9.2 17.5 20 6.5" pathLength="1" /></svg>
          </span>
          <span className="sl-copy__label">Copy</span>
        </span>
      </button>
      <span ref={feedback} className="nv-copy__feedback" role="status" aria-live="polite" aria-atomic="true" />
    </span>
  );
}

// ---------------------------------------------------------------- share

/** Share button with a small panel: the link, Copy link and the system share sheet. */
export function SlShare({ url }: { url: string }) {
  const latest = useRef(url);
  latest.current = url;
  const feedback = useRef<HTMLSpanElement>(null);
  const [ref] = useSl<Destroyable>(
    // @ts-expect-error -- side-effect script with no exports
    () => import("./sl-ui/share/buttons.js"),
    (el) => lib("MatteShare").mount(el, { getUrl: () => latest.current, feedback: feedback.current }),
  );
  return (
    <span className="nv-share">
      <div ref={ref as RefObject<HTMLDivElement>} className="sl-share-control">
        <button className="sl-share" type="button" aria-label="Share link" aria-expanded="false" disabled>
          <span className="sl-share__surface" aria-hidden="true"><span className="sl-share__icon"><svg viewBox="0 0 24 24" fill="none" focusable="false"><circle cx="6" cy="12" r="2.6" /><g className="sl-share__upper"><path d="m8.4 10.7 7.2-4" /><circle cx="18" cy="5.4" r="2.6" /></g><g className="sl-share__lower"><path d="m8.4 13.3 7.2 4" /><circle cx="18" cy="18.6" r="2.6" /></g></svg></span><span className="sl-share__label">Share</span></span>
        </button>
        <div className="sl-share__popover" role="group" aria-label="Share link options" aria-hidden="true" inert>
          <input className="sl-share__url" type="text" readOnly aria-label="Link to share" spellCheck={false} />
          <button className="sl-share__copy" type="button">Copy link</button>
          <button className="sl-share__send" type="button" hidden>Share…</button>
        </div>
      </div>
      <span ref={feedback} className="fb-sr" role="status" aria-live="polite" aria-atomic="true" />
    </span>
  );
}

// ---------------------------------------------------------------- review decision

/** One join request: Approve or Decline. `onDecide` runs the real call; the list then reloads. */
export function SlReviewDecision({ account, onDecide, approveBlocked }: { account: string; onDecide: (approve: boolean) => void; approveBlocked?: string }) {
  const latest = useRef(onDecide);
  latest.current = onDecide;
  const [ref] = useSl<Destroyable>(
    // @ts-expect-error -- side-effect script with no exports
    () => import("./sl-ui/review-decision/buttons.js"),
    (el) => {
      const c = lib("SLComponent").mount(el);
      el.addEventListener("sl:action", (e) => {
        const decision = (e as CustomEvent).detail?.decision;
        if (decision) latest.current(decision === "approve");
      });
      return c;
    },
  );
  return (
    <section ref={ref as RefObject<HTMLElement>} className="sl-component nv-review" data-kind="buttons-review-decision" data-phase="idle" aria-label={`Join request from ${shortAccount(account)}`} aria-busy="false">
      <p className="ab-eyebrow">Request</p>
      <h2 className="nv-review__who"><Avatar account={account} size={32} /><span data-tooltip={account}>{shortAccount(account)}</span></h2>
      <p className="ab-description">Wants to join this event.</p>
      <div className="ab-decision-mark" data-mark=""><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-approval="" d="m5 12 4 4L19 6" /><path data-rejection="" d="m6 6 12 12M6 18 18 6" style={{ opacity: 0 }} /></svg><span data-decision="">Awaiting review</span></div>
      <div className="ab-actions ab-decisions">
        <button type="button" className="ab-primary" data-approve="" aria-pressed="false" disabled={!!approveBlocked} data-tooltip={approveBlocked}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6" /></svg>Approve</button>
        <button type="button" className="ab-danger" data-reject="" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M6 18 18 6" /></svg>Decline</button>
      </div>
      <p className="ab-status" data-status="" role="status" aria-live="polite" aria-atomic="true">No decision selected.</p>
      <p className="ab-note" data-note="">Guests see the result on the event page.</p>
    </section>
  );
}

// ---------------------------------------------------------------- amount

/** USDC amount field: plain number while typing, grouped on blur. Reports the number as a string. */
export function SlAmount({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const [ref] = useSl<Destroyable>(
    // @ts-expect-error -- side-effect script with no exports
    () => import("./sl-ui/amount/buttons.js"),
    (el) => {
      const c = lib("MatteAmountInput").mount(el, { locale: "en-US", minimumFractionDigits: 0, maximumFractionDigits: 2 });
      el.addEventListener("amountchange", (e) => latest.current(String((e as CustomEvent).detail.amount)));
      return c;
    },
  );
  const [first] = useState(value);
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="sl-field sl-field--amount nv-amount" data-amount-state="formatted">
      <div className="sl-field__control">
        <span className="sl-field__currency" aria-hidden="true">$</span>
        <input className="sl-field__input" id="nv-amount" type="text" placeholder=" " defaultValue={first} autoComplete="off" inputMode="decimal" aria-describedby="nv-amount-help" onInput={(e) => latest.current(e.currentTarget.value.replace(/[\s,]/g, ""))} />
        <label className="sl-field__label" htmlFor="nv-amount">{label}</label>
        <span className="sl-field__currency-code" aria-hidden="true">USDC</span>
      </div>
      <p className="sl-field__helper" id="nv-amount-help" role="status" aria-live="polite">At least 0.1 USDC.</p>
    </div>
  );
}

// ---------------------------------------------------------------- avatars

const TINTS = ["sage", "blue", "sand", "rose"];

/** Who's going: three faces, the rest behind +N. Picking one shows the name and a profile link. */
export function SlAvatars({ accounts, names = {}, role }: { accounts: string[]; names?: Record<string, string>; role: string }) {
  const nameOf = (a: string) => names[a] || shortAccount(a);
  const lead = accounts.slice(0, 3);
  const rest = accounts.slice(3);
  const [selected, setSelected] = useState(lead[0]);
  // The controller rewrites the name and role text; React renders only the first values.
  const [first] = useState(() => ({ name: lead[0] ? nameOf(lead[0]) : "" }));
  const [ref] = useSl<Destroyable & { state: { expanded: boolean } }>(
    // @ts-expect-error -- side-effect script with no exports
    () => import("./sl-ui/avatars/buttons.js"),
    (el) =>
      lib("MatteDataDisplay").mount(el, {
        onChange(detail: { action: string; selected?: string; expanded?: boolean }) {
          if (detail.action === "select" && detail.selected) setSelected(detail.selected);
          // The library writes "+1" on the toggle; keep the real count.
          const more = el.querySelector<HTMLElement>('[data-action="toggle"]');
          if (detail.action === "toggle" && more && !detail.expanded) more.textContent = `+${rest.length}`;
        },
      }),
  );
  const initials = (a: string) => nameOf(a).replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "?";
  return (
    <div ref={ref as RefObject<HTMLDivElement>} className="dd-demo nv-avatars" data-display="avatars" tabIndex={-1}>
      <section className="dd-card dd-card--avatars" aria-label="Guests">
        <div className="dd-avatars" role="group" aria-label="Guests">
          {lead.map((a, i) => (
            <button key={a} type="button" className={`dd-avatar dd-avatar--${TINTS[i % 4]}`} data-action="member" data-value={a} data-name={nameOf(a)} data-role={role} aria-label={`${nameOf(a)}, ${role}`} aria-pressed={a === selected}>
              <Avatar account={a} size={36} />
            </button>
          ))}
          {rest.length > 0 && (
            <button type="button" className="dd-avatar dd-avatar--more" data-action="toggle" aria-expanded="false" aria-label={`Show all ${accounts.length} guests`}>+{rest.length}</button>
          )}
        </div>
        <div className="dd-person">
          <strong data-member-name="">{first.name}</strong>
          <a className="nv-avatars__profile" href={selected ? `/u/${encodeURIComponent(selected)}` : "#"} data-member-role="">{role}</a>
        </div>
        {rest.length > 0 && (
          <div className="dd-collapse" data-expanded="false" data-extra="" aria-hidden="true" inert>
            <div>
              <div className="dd-member-list">
                {rest.map((a, i) => (
                  <button key={a} type="button" data-action="member" data-value={a} data-name={nameOf(a)} data-role={role} aria-pressed="false">
                    <span className={`dd-mini-avatar dd-avatar--${TINTS[(i + 3) % 4]}`}>{initials(a)}</span>
                    <span>{nameOf(a)}<small>{role}</small></span>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m8 5 7 7-7 7" /></svg>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
      <span className="dd-sr" data-live="" role="status" aria-live="polite" aria-atomic="true" />
    </div>
  );
}

// ---------------------------------------------------------------- confirm

type ConfirmRequest = { title: string; text: string; confirm: string; resolve: (ok: boolean) => void };

/** Asks before an irreversible action. The first line of `message` is the title. */
export function confirmAction(message: string, confirm = "Confirm"): Promise<boolean> {
  const [title, ...rest] = message.split("\n");
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent("nv:confirm", { detail: { title, text: rest.join("\n").trim(), confirm, resolve } })));
}

type Overlay = { open(): void; close(): void };
// The adapter is plain JSX; these are the props it documents.
const ConfirmOverlay = ConfirmComponent as unknown as ComponentType<{ callbacks: Record<string, () => void>; onReady: (c: Overlay) => void }>;

/** One SL UI confirmation dialog for the whole app, in its own Shadow DOM. */
export function ConfirmHost() {
  const ctl = useRef<Overlay | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const pending = useRef<ConfirmRequest | null>(null);
  const committed = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const req = (e as CustomEvent<ConfirmRequest>).detail;
      const root = host.current?.querySelector("[data-sl-react]")?.firstElementChild?.shadowRoot;
      if (!ctl.current || !root) return req.resolve(window.confirm(`${req.title}\n\n${req.text}`));
      pending.current?.resolve(false);
      pending.current = req;
      committed.current = false;
      root.querySelector("#panel-title")!.textContent = req.title;
      root.querySelector("#panel-description")!.textContent = req.text;
      root.querySelector(".overlay-primary")!.textContent = req.confirm;
      // What the library announces after a confirm.
      (root.querySelector(".overlay-demo") as HTMLElement).dataset.success = `${req.confirm}: confirmed.`;
      opener.current = document.activeElement as HTMLElement | null;
      ctl.current.open();
    };
    window.addEventListener("nv:confirm", on);
    return () => window.removeEventListener("nv:confirm", on);
  }, []);

  const settle = (ok: boolean) => {
    pending.current?.resolve(ok);
    pending.current = null;
    opener.current?.focus({ preventScroll: true });
  };

  return (
    <div ref={host} className="nv-confirm">
      <ConfirmOverlay
        callbacks={{ onCommit: () => { committed.current = true; settle(true); } }}
        onReady={(c: Overlay) => {
          ctl.current = c;
          const root = host.current?.querySelector("[data-sl-react]")?.firstElementChild?.shadowRoot;
          if (!root) return;
          const style = document.createElement("style");
          style.textContent = CONFIRM_STYLE;
          root.append(style);
          root.querySelector('[data-close][autofocus]')!.textContent = "Go back";
          // The library's own launcher stays mounted but out of reach; confirmAction opens the dialog.
          const launch = root.querySelector(".overlay-launch") as HTMLElement;
          launch.setAttribute("aria-hidden", "true");
          launch.querySelector("button")!.tabIndex = -1;
          launch.querySelector("[data-feedback]")!.textContent = "";
          root.querySelector(".overlay-panel")!.addEventListener("close", () => { if (!committed.current) settle(false); });
        }}
      />
    </div>
  );
}

// Host-token adaptation for the Shadow DOM copy: light surface, app font, launcher hidden
// (the dialog is opened by confirmAction, not by its own trigger).
const CONFIRM_STYLE = `
:host{font-family:inherit!important}
.overlay-demo{min-height:0}
.overlay-launch{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.overlay-panel{font-family:inherit;color:var(--text,#1c1520);background:var(--surface,#fff);border-color:var(--border,#eadfe6);box-shadow:0 20px 48px #1c152024;width:min(400px,calc(100vw - 32px))}
.overlay-panel h2{font-family:var(--font-display,inherit);font-weight:600}
.overlay-panel p{color:var(--muted,#6b6070);font-size:13px;white-space:pre-line}
.overlay-panel::backdrop{background:#1c152059;backdrop-filter:blur(2px)}
.overlay-close{color:var(--muted,#6b6070)}.overlay-close:hover{color:var(--text,#1c1520);background:#1c15200a}
.overlay-emblem{color:var(--danger,#c2410c);border-color:color-mix(in srgb,var(--danger,#c2410c) 30%,transparent)}
.confirm-summary{display:none}
.overlay-actions button{font-size:13px;color:var(--text,#1c1520)}
.overlay-actions .overlay-primary{background:var(--accent,#c8336a);border-color:var(--accent,#c8336a);color:#fff}
.overlay-primary:hover{filter:brightness(1.08);background:var(--accent,#c8336a)}
`;
