import type { CSSProperties } from "react";

// Event page themes, picked in the creator like Luma's theme bar. A theme is
// stored in the event's `cover_url` (the contract has no theme field), as
// `theme:<name>?c=<hex>&f=<font>&d=<light|dark>&e=<emoji>&i=<image url>`.

export type ThemeName =
  | "minimal"
  | "quantum"
  | "ambient"
  | "texture"
  | "emoji"
  | "confetti"
  | "pattern"
  | "playful"
  | "seasonal"
  | "papertrade"
  | "near";
export type FontKey = "sans" | "grotesk" | "serif" | "rounded" | "mono" | "inter";
export type Display = "light" | "dark";

export interface Theme {
  name: ThemeName;
  color: string;
  font: FontKey;
  display: Display;
  emoji: string;
  image: string | null;
}

interface Preset {
  label: string;
  color: string;
  font: FontKey;
  display: Display;
}

export const THEMES: Record<ThemeName, Preset> = {
  minimal: { label: "Minimal", color: "#5b4bff", font: "sans", display: "light" },
  quantum: { label: "Quantum", color: "#7c6cff", font: "grotesk", display: "dark" },
  ambient: { label: "Ambient", color: "#ff7a59", font: "sans", display: "light" },
  texture: { label: "Texture", color: "#2f6f4f", font: "serif", display: "light" },
  emoji: { label: "Emoji", color: "#f59e0b", font: "rounded", display: "light" },
  confetti: { label: "Confetti", color: "#ec4899", font: "rounded", display: "light" },
  pattern: { label: "Pattern", color: "#0ea5e9", font: "grotesk", display: "light" },
  playful: { label: "Playful", color: "#16a34a", font: "rounded", display: "light" },
  seasonal: { label: "Seasonal", color: "#c2410c", font: "serif", display: "light" },
  papertrade: { label: "Papertrade", color: "#8b2020", font: "inter", display: "light" },
  near: { label: "NEAR", color: "#00ec97", font: "grotesk", display: "dark" },
};

export const COLORS = ["#5b4bff", "#ec4899", "#ef4444", "#f59e0b", "#16a34a", "#0ea5e9", "#00ec97", "#16161a"];

export const FONTS: Record<FontKey, { label: string; css: string }> = {
  sans: { label: "Geist", css: "var(--font-geist-sans), system-ui, sans-serif" },
  inter: { label: "Inter", css: "var(--font-inter), system-ui, sans-serif" },
  grotesk: { label: "Grotesk", css: "var(--font-grotesk), system-ui, sans-serif" },
  serif: { label: "Serif", css: "var(--font-serif), Georgia, serif" },
  rounded: { label: "Rounded", css: "var(--font-rounded), system-ui, sans-serif" },
  mono: { label: "Mono", css: "var(--font-geist-mono), ui-monospace, monospace" },
};

const HEX = /^#[0-9a-f]{6}$/i;

export function defaultTheme(name: ThemeName = "minimal"): Theme {
  const p = THEMES[name];
  return { name, color: p.color, font: p.font, display: p.display, emoji: "🎉", image: null };
}

export function encodeTheme(t: Theme): string {
  const q = new URLSearchParams({ c: t.color.slice(1), f: t.font, d: t.display });
  if (t.name === "emoji") q.set("e", t.emoji);
  if (t.image) q.set("i", t.image);
  return `theme:${t.name}?${q}`;
}

/** Reads a theme from `cover_url`; plain images and older presets become Minimal. */
export function decodeTheme(cover: string | null | undefined): Theme {
  if (cover?.startsWith("theme:")) {
    const [name, query = ""] = cover.slice(6).split("?");
    if (name in THEMES) {
      const q = new URLSearchParams(query);
      const base = defaultTheme(name as ThemeName);
      const c = `#${q.get("c") ?? ""}`;
      const f = q.get("f") as FontKey | null;
      const i = q.get("i");
      return {
        ...base,
        color: HEX.test(c) ? c : base.color,
        font: f && f in FONTS ? f : base.font,
        display: q.get("d") === "dark" ? "dark" : q.get("d") === "light" ? "light" : base.display,
        emoji: [...(q.get("e") ?? base.emoji)].slice(0, 2).join(""),
        image: i && /^https:\/\//.test(i) ? i : null,
      };
    }
  }
  const t = defaultTheme();
  if (cover && /^https:\/\//.test(cover)) t.image = cover;
  return t;
}

const svg = (body: string, w = 120, h = 120) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

const LIGHT = { "--bg": "#ffffff", "--surface": "#ffffff", "--text": "#16161a", "--muted": "#6b6b76", "--border": "#ebebef" };
const DARK = { "--bg": "#0b0b10", "--surface": "#15151c", "--text": "#f2f2f4", "--muted": "#a0a0ad", "--border": "#2a2a33" };

/** CSS variables for the page plus the background drawn behind it. */
export function themeStyle(t: Theme): { vars: CSSProperties; background: string } {
  const dark = t.display === "dark";
  const base: Record<string, string> = { ...(dark ? DARK : LIGHT) };
  const c = t.color;
  let background = "var(--bg)";

  switch (t.name) {
    case "quantum":
      background = `radial-gradient(40% 35% at 20% 10%, ${c}55, transparent 70%), radial-gradient(35% 30% at 85% 30%, ${c}33, transparent 70%),
        linear-gradient(${dark ? "#ffffff0a" : "#0000000a"} 1px, transparent 1px) 0 0 / 32px 32px,
        linear-gradient(90deg, ${dark ? "#ffffff0a" : "#0000000a"} 1px, transparent 1px) 0 0 / 32px 32px, var(--bg)`;
      break;
    case "ambient":
      background = `radial-gradient(55% 45% at 10% 0%, ${c}55, transparent 70%), radial-gradient(50% 45% at 95% 20%, ${c}33, transparent 70%),
        radial-gradient(60% 50% at 50% 100%, ${c}22, transparent 70%), var(--bg)`;
      break;
    case "texture":
      background = `${svg(
        "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .08 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/>",
        200,
        200,
      )}, linear-gradient(${c}14, ${c}14), var(--bg)`;
      break;
    case "emoji":
      background = `${svg(`<text x='18' y='42' font-size='26' opacity='.22'>${t.emoji}</text><text x='78' y='102' font-size='26' opacity='.22'>${t.emoji}</text>`)}, var(--bg)`;
      break;
    case "confetti": {
      const dots = ["#ec4899", "#f59e0b", "#0ea5e9", "#16a34a", c]
        .map((col, i) => `<rect x='${(i * 37) % 120}' y='${(i * 53) % 120}' width='6' height='12' rx='2' fill='${col}' opacity='.5' transform='rotate(${i * 40} ${(i * 37) % 120} ${(i * 53) % 120})'/>`)
        .join("");
      background = `${svg(dots)}, var(--bg)`;
      break;
    }
    case "pattern":
      background = `radial-gradient(${c}40 1.5px, transparent 1.6px) 0 0 / 18px 18px, var(--bg)`;
      break;
    case "playful":
      background = `radial-gradient(circle at 8% 15%, ${c}40 0 90px, transparent 91px), radial-gradient(circle at 92% 35%, #f59e0b40 0 70px, transparent 71px),
        radial-gradient(circle at 20% 85%, #ec489933 0 110px, transparent 111px), var(--bg)`;
      break;
    case "seasonal":
      background = `${svg("<text x='14' y='40' font-size='22' opacity='.25'>🍂</text><text x='74' y='96' font-size='18' opacity='.2'>🍁</text>")},
        linear-gradient(180deg, ${c}1f, transparent 60%), var(--bg)`;
      break;
    case "papertrade":
      // papertrade.xyz: cream paper, warm ink, a red stamp colour.
      Object.assign(base, {
        "--bg": "#f4ecd8",
        "--surface": "#f9f3e6",
        "--text": "#2a2520",
        "--muted": "#544f44",
        "--border": "#58544a33",
      });
      background = `repeating-linear-gradient(0deg, #58544a12 0 1px, transparent 1px 28px), var(--bg)`;
      break;
    case "near":
      // NEAR brand: black and white with the NEAR green.
      Object.assign(base, dark ? { "--bg": "#000000", "--surface": "#111111", "--border": "#262626" } : { "--bg": "#f2f1ea" });
      background = `radial-gradient(45% 35% at 85% 0%, ${c}30, transparent 70%), var(--bg)`;
      break;
  }

  const onAccent = /^#(00ec97|f59e0b|ffffff)$/i.test(c) ? "#000000" : "#ffffff";
  return {
    vars: {
      ...base,
      "--accent": c,
      "--accent-soft": `color-mix(in srgb, ${c} 16%, transparent)`,
      "--on-accent": onAccent,
      "--theme-font": FONTS[t.font].css,
      colorScheme: dark ? "dark" : "light",
    } as CSSProperties,
    background,
  };
}

/** The cover drawn for a theme when the host gave no image. */
export function themeCover(t: Theme): string {
  const c = t.color;
  if (t.name === "papertrade")
    // A paper card with a strip of tape and a red stamp, like papertrade.xyz.
    return `linear-gradient(#f4ecd8a0, #f4ecd8a0) 30% 6% / 40% 9% no-repeat,
      radial-gradient(circle at 68% 62%, transparent 0 22%, ${c}cc 22.5% 25%, transparent 25.5%),
      repeating-linear-gradient(0deg, #58544a14 0 1px, transparent 1px 14px), #efe4ca`;
  if (t.name === "near") return `radial-gradient(circle at 70% 30%, ${c}, transparent 55%), #000`;
  if (t.name === "emoji") return `${svg(`<text x='30' y='80' font-size='60'>${t.emoji}</text>`)} center/60% no-repeat, ${c}33`;
  return `radial-gradient(circle at 25% 25%, ${c}, transparent 60%), radial-gradient(circle at 80% 75%, ${c}99, transparent 55%), ${t.display === "dark" ? "#14121f" : `${c}26`}`;
}
