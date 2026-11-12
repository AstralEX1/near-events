"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./EventSections";
import "./sl-ui/light-dark/buttons.css";
import "./AppearancePicker.css";

type Controller = { destroy(): void };
type LightDark = { mount(root: HTMLElement, options: { target: HTMLElement; on: boolean; onChange(on: boolean): void }): Controller };

// Lucide paths (ISC).
const SUN = ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"];
const MOON = ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"];

const isDark = () => {
  const theme = document.documentElement.dataset.theme;
  return theme ? theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
};

function applyTheme(on: boolean, from: HTMLElement) {
  const flip = () => {
    const theme = on ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    // The /about landing iframe listens for this key (storage event) and follows.
    try { localStorage.setItem("near-me:appearance", theme); } catch {}
  };
  if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return flip();
  // The SL UI demo spreads night over the page from the switch; here the real new theme opens as that circle.
  const box = from.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.startViewTransition(flip).ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
    { duration: 780, easing: "cubic-bezier(.32,.72,0,1)", pseudoElement: "::view-transition-new(root)" },
  )).catch(() => {});
}

/**
 * Light / dark for the whole site: SL UI Library "Light / Dark" (Product set, white palette; package in
 * sl-ui/light-dark, downloaded by Alex, not in the bundled offline catalog). Source markup and controller;
 * sun and moon instead of the words, header size and app colors in AppearancePicker.css.
 */
export function AppearancePicker() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current;
    let alive = true, controller: Controller | null = null;
    // @ts-expect-error -- browser script with no exports; it sets window.SLLightDark
    import("./sl-ui/light-dark/buttons.js").then(() => {
      const api = (window as unknown as { SLLightDark?: LightDark }).SLLightDark;
      if (!alive || !root || !api) return;
      // target = the switch itself: the night circle stays under the plate; the page gets the view transition instead.
      // mount() reports the starting state through onChange too; only presses after it change the theme.
      controller = api.mount(root, { target: root, on: isDark(), onChange: (on) => { if ("ready" in root.dataset) applyTheme(on, root); } });
      root.dataset.ready = "";
    });
    // Next hides and later re-shows pages (Activity) with this DOM kept: put back the fresh markup state
    // the controller starts from, so the next mount sets the current theme without animating.
    return () => {
      alive = false;
      controller?.destroy();
      if (!root) return;
      delete root.dataset.ready;
      root.dataset.on = "false";
      root.querySelector(".ld-switch")?.setAttribute("aria-checked", "false");
    };
  }, []);

  return (
    <div ref={host} className="pb pb-f pb-lightdark ld nv-theme" data-on="false">
      <div className="ld-plate">
        <button className="ld-switch" type="button" role="switch" aria-checked="false" aria-label="Dark mode">
          <span className="ld-seg"><i /><span className="day"><Icon paths={SUN} size={16} /></span><span className="night"><Icon paths={MOON} size={16} /></span></span>
        </button>
      </div>
    </div>
  );
}
