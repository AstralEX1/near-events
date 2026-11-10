"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./sl-ui/approval-toggle/buttons.css";
import "./ApprovalToggle.css";

type Controller = { setChecked(value: boolean, options?: { emit?: boolean; animate?: boolean }): void; destroy(): void };

/**
 * "Require approval" for free events, built on the SL UI Library `matte-privacy-toggle`
 * (variant `privacy-toggle`): the source markup and controller, restyled as a compact option row.
 */
export function ApprovalToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const id = useId();
  const checkedRef = useRef(checked);
  checkedRef.current = checked;
  // The controller owns the status text after mount; React only renders the first value.
  const [firstStatus] = useState(checked ? "You approve each guest" : "Anyone can join");

  useEffect(() => {
    let alive = true;
    // The controller is a browser IIFE that sets window.MatteToggle; load it only on the client.
    // @ts-expect-error -- side-effect script with no exports
    import("./sl-ui/approval-toggle/buttons.js").then(() => {
      const api = (window as unknown as { MatteToggle?: { mount(el: HTMLElement, o: { onChange(v: boolean): void }): Controller } }).MatteToggle;
      if (!alive || !root.current || !api) return;
      controller.current = api.mount(root.current, { onChange: (v) => latest.current(v) });
      controller.current.setChecked(checkedRef.current, { animate: false });
    });
    return () => {
      alive = false;
      controller.current?.destroy();
      controller.current = null;
    };
  }, []);

  useEffect(() => controller.current?.setChecked(checked, { animate: false }), [checked]);

  return (
    <div ref={root} className="sl-toggle sl-toggle--privacy nv-approval lu-row" data-checked={String(checked)}>
      <span className="sl-toggle__emblem" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path className="sl-lock__shackle" d="M10 13V10a6 6 0 0 1 12 0v3" />
          <rect className="sl-lock__body" x="7" y="13" width="18" height="14" rx="4" />
          <path className="sl-lock__key" pathLength="1" d="M16 19v3" />
        </svg>
      </span>
      <label className="sl-toggle__label" htmlFor={id}>
        <span className="sl-toggle__copy">
          <span className="sl-toggle__title">Require approval</span>
          <span className="sl-toggle__status" data-status="">{firstStatus}</span>
        </span>
      </label>
      <span className="sl-toggle__switch">
        <input className="sl-toggle__input" id={id} type="checkbox" defaultChecked={checked} data-on="You approve each guest" data-off="Anyone can join" />
        <span className="sl-toggle__track" aria-hidden="true">
          <span className="sl-toggle__thumb" />
        </span>
      </span>
    </div>
  );
}
