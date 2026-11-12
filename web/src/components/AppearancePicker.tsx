"use client";

import { Icon } from "./EventSections";

// Lucide paths (ISC). CSS shows the moon in light mode and the sun in dark mode, so the icon is right before hydration.
const SUN = ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"];
const MOON = ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"];

export function AppearancePicker() {
  function toggle() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    root.dataset.theme = next;
    // The /about landing iframe listens for this key (storage event) and follows.
    try { localStorage.setItem("near-me:appearance", next); } catch {}
  }

  return (
    <button type="button" className="gc-appearance" onClick={toggle} aria-label="Switch light or dark theme" data-tooltip="Light or dark theme">
      <span className="gc-moon"><Icon paths={MOON} size={18} /></span>
      <span className="gc-sun"><Icon paths={SUN} size={18} /></span>
    </button>
  );
}
