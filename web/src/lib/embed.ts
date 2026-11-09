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

/**
 * The host's own registration form, opened after the deposit is paid, so we sit
 * in front of their usual flow (Luma, Typeform, Google Forms…) instead of
 * replacing it. `{account}` and `{event}` in it are filled in, so the host can
 * match a form entry to a payment. https only (http on localhost for testing).
 */
export function readThen(q: URLSearchParams, account?: string | null, eventId?: number): string | null {
  const raw = q.get("then");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return raw
      .replaceAll("{account}", encodeURIComponent(account ?? ""))
      .replaceAll("{event}", eventId === undefined ? "" : String(eventId));
  } catch {
    return null;
  }
}

/** Only the params above (and `then`), so they can be passed on to the sign-up window. */
export function embedQuery(q: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of ["theme", "accent", "font", "display", "radius", "then"]) {
    const v = q.get(k);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export function embedReturnPath(value: string | null, eventId: number): string | null {
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://near.me");
    return url.origin === "https://near.me" && url.pathname === `/embed/e/${eventId}/join` && !url.hash
      ? `${url.pathname}${embedQuery(url.searchParams)}`
      : null;
  } catch {
    return null;
  }
}

const FONTS = {
  geist: "var(--font-geist-sans), system-ui, sans-serif",
  poppins: "var(--font-poppins), system-ui, sans-serif",
  system: "system-ui, -apple-system, sans-serif",
};

/** CSS variables that override the app theme inside the embed. */
export function embedVars(s: EmbedStyle): CSSProperties {
  const vars: Record<string, string> = { "--embed-font": FONTS[s.font] };
  if (s.accent) {
    vars["--accent"] = s.accent;
    vars["--on-accent"] = "#ffffff";
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
