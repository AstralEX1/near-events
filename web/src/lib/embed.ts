import type { CSSProperties } from "react";

// Look of an embed, read from its URL so a host site can match its own brand:
// ?theme=light|dark|auto (default light)&accent=%23ff4d1f&font=poppins&display=serif&radius=12
export interface EmbedStyle {
  theme: "light" | "dark" | "auto";
  accent: string | null;
  font: "geist" | "poppins" | "system";
  display: "sans" | "serif";
  radius: number | null;
}

const HEX = /^#[0-9a-f]{3,8}$/i;

export function readEmbedStyle(q: URLSearchParams): EmbedStyle {
  const theme = q.get("theme");
  const font = q.get("font");
  const accent = q.get("accent");
  const radius = Number(q.get("radius"));
  return {
    theme: theme === "dark" || theme === "auto" ? theme : "light",
    accent: accent && HEX.test(accent) ? accent : null,
    font: font === "poppins" || font === "system" ? font : "geist",
    display: q.get("display") === "serif" ? "serif" : "sans",
    radius: Number.isFinite(radius) && radius >= 0 && radius <= 32 && q.has("radius") ? radius : null,
  };
}

/** Only the params above, so they can be passed on to the sign-up window. */
export function embedQuery(q: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of ["theme", "accent", "font", "display", "radius"]) {
    const v = q.get(k);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

const LIGHT = { "--bg": "#f6f5f2", "--surface": "#ffffff", "--text": "#16161a", "--muted": "#6b6b76", "--border": "#e7e5e0" };
const DARK = { "--bg": "#111114", "--surface": "#1a1a1f", "--text": "#f2f2f4", "--muted": "#9a9aa6", "--border": "#2a2a31" };
const FONTS = {
  geist: "var(--font-geist-sans), system-ui, sans-serif",
  poppins: "var(--font-poppins), system-ui, sans-serif",
  system: "system-ui, -apple-system, sans-serif",
};

/** CSS variables that override the app theme inside the embed. */
export function embedVars(s: EmbedStyle): CSSProperties {
  const vars: Record<string, string> = { "--embed-font": FONTS[s.font] };
  if (s.theme === "light") Object.assign(vars, LIGHT);
  if (s.theme === "dark") Object.assign(vars, DARK);
  if (s.accent) {
    vars["--accent"] = s.accent;
    vars["--accent-soft"] = `color-mix(in srgb, ${s.accent} 14%, transparent)`;
  }
  vars["--embed-display"] = s.display === "serif" ? "var(--font-serif), Georgia, serif" : vars["--embed-font"];
  vars["--embed-radius"] = s.radius === null ? "1rem" : `${s.radius}px`;
  return { ...vars, colorScheme: s.theme === "auto" ? "light dark" : s.theme } as CSSProperties;
}

/** Messages the embed sends to the page it sits on. */
export type EmbedMessage =
  | { type: "near-events:resize"; height: number }
  | { type: "near-events:registered"; eventId: number; accountId: string };
