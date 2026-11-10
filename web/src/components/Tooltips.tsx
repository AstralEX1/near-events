"use client";

import { useEffect } from "react";

const GAP = 14; // MUI's distance from the anchor on desktop
const EDGE = 8;

/**
 * One tooltip for the whole app, styled like MUI's (https://mui.com/material-ui/react-tooltip/).
 * Put `data-tooltip="…"` on any element; it shows on hover and keyboard focus, below the element,
 * or above when there is no room.
 */
export function Tooltips() {
  useEffect(() => {
    const tip = document.createElement("div");
    tip.id = "nv-tooltip";
    tip.className = "nv-tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.append(tip);
    let anchor: HTMLElement | null = null;
    let timer = 0;

    const hide = () => {
      clearTimeout(timer);
      anchor?.removeAttribute("aria-describedby");
      anchor = null;
      tip.classList.remove("is-open");
    };

    const show = (el: HTMLElement) => {
      if (el === anchor) return;
      hide();
      const text = el.dataset.tooltip?.trim();
      if (!text) return;
      anchor = el;
      tip.textContent = text; // set now so screen readers get the description on focus
      el.setAttribute("aria-describedby", tip.id);
      timer = window.setTimeout(() => {
        const a = el.getBoundingClientRect();
        const t = { width: tip.offsetWidth, height: tip.offsetHeight }; // unscaled size, unlike getBoundingClientRect
        const below = a.bottom + GAP + t.height <= window.innerHeight - EDGE || a.top - GAP - t.height < EDGE;
        const left = Math.min(Math.max(a.left + a.width / 2 - t.width / 2, EDGE), window.innerWidth - t.width - EDGE);
        tip.style.left = `${left}px`;
        tip.style.top = `${below ? a.bottom + GAP : a.top - GAP - t.height}px`;
        tip.style.transformOrigin = `${a.left + a.width / 2 - left}px ${below ? "top" : "bottom"}`;
        tip.classList.add("is-open");
      }, 100); // MUI enterDelay
    };

    const find = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-tooltip]") ?? null;
    const onOver = (e: Event) => { const el = find(e); if (el) show(el); else hide(); };
    const onFocus = (e: Event) => { const el = find(e); if (el?.matches(":focus-visible")) show(el); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    // A tap on a tooltip element keeps it open (touch has no hover); any other press closes it.
    const onDown = (e: PointerEvent) => { if (e.pointerType === "mouse" || !find(e)) hide(); };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      tip.remove();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);
  return null;
}
