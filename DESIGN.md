---
version: alpha
name: Nearvent — Party poster
description: Brand book for Nearvent, a deposit-backed event app. Read this before any UI, landing, image or copy work. Code values live in web/public/brand/tokens.css; this file explains how to use them.
colors:
  bg: "#fff6fb"
  surface: "#ffffff"
  text: "#1e0b2b"
  muted: "#6e5a78"
  border: "#f1dce8"
  field-border: "#b79dbd"
  accent: "#d61f69"
  on-accent: "#ffffff"
  accent-soft: "#ffe4f0"
  logo-pink: "#ff3d8b"
  brand: "#ffb3d2"
  sun: "#ffd23f"
  violet: "#d2ccff"
  good: "#237a57"
  warn: "#8c5a13"
  danger: "#b53e49"
  dark-bg: "#1a0b22"
  dark-surface: "#28132f"
  dark-text: "#fff6fb"
  dark-muted: "#cdb8d6"
  dark-border: "#462a52"
  dark-accent: "#ff6aa8"
  dark-on-accent: "#1e0b2b"
typography:
  logo:
    fontFamily: Geist
    fontSize: 27px
    fontWeight: 800
    lineHeight: 1
    letterSpacing: -0.04em
  display:
    fontFamily: Geist
    fontSize: 2.75rem
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.045em
  h3:
    fontFamily: Geist
    fontSize: 1.5rem
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: -0.035em
  body:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: Geist
    fontSize: 0.85rem
    fontWeight: 500
    lineHeight: 1.4
  eyebrow:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: 0.12em
  number:
    fontFamily: Geist Mono
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: 10px
  md: 12px
  lg: 16px
  card: 20px
  xl: 24px
  form: 28px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  section: 48px
  page-max: 1088px
components:
  button-primary:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 10px 18px
    height: 44px
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: 12px 18px
    height: 44px
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: 44px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 10px 14px
    height: 46px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: 16px
  chip:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.full}"
    padding: 2px 8px
  logo:
    textColor: "{colors.text}"
    typography: "{typography.logo}"
---

# Nearvent brand book

This is the single brand reference for people and AI agents. It follows the
[DESIGN.md format](https://github.com/google-labs-code/design.md): the YAML
above holds the values, the text below says how to use them.

**Source of truth.** Code reads colors and fonts from
[`web/public/brand/tokens.css`](web/public/brand/tokens.css) and
[`web/public/brand/fonts.css`](web/public/brand/fonts.css). When a value
changes, change it there and here in the same commit. The static landing
([`web/public/landing/index.html`](web/public/landing/index.html)) keeps its
own copy of the palette at the top of its `<style>`; keep it in sync too.

**Check this file:** `npx @google/design.md lint DESIGN.md` (run from the repo root).

## Overview

Direction "Party poster" (chosen by Alex on 2026-11-10, see
`DECISIONS.md`), inspired by Partiful and BaliSquad: a friendly
invitation to a real get-together, with clear rules about money.

- Feeling: warm, playful, confident, adult. An invitation, not a fintech dashboard.
- One loud color (hot pink) on a soft blush background with dark ink text.
- Slogan: **"Events people actually show up to."** Keep it as is.
- Main audience of the landing: hosts of small community events. A guest
  usually lands on one event page, so that page sells the event, not Nearvent.
- Event pages may wear their own theme (see [Event themes](#event-themes));
  the Nearvent chrome around them (header, buttons, checkout) stays on brand.

## Colors

All colors are CSS variables in [`tokens.css`](web/public/brand/tokens.css).
In code always use the variable (`var(--accent)`) or the Tailwind alias
(`bg-accent`, `text-muted`, `border-border`), never a raw hex.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#fff6fb` blush | `#1a0b22` | Page background |
| `--surface` | `#ffffff` | `#28132f` | Cards, inputs, menus |
| `--text` | `#1e0b2b` ink | `#fff6fb` | Main text, primary button |
| `--muted` | `#6e5a78` | `#cdb8d6` | Secondary text, labels |
| `--border` | `#f1dce8` | `#462a52` | Hairlines, card borders |
| `--field-border` | `#b79dbd` | `#8f6f9a` | Input borders |
| `--accent` | `#d61f69` hot pink | `#ff6aa8` | Links, accent buttons, focus ring, selected state |
| `--on-accent` | `#ffffff` | `#1e0b2b` | Text on accent |
| `--accent-soft` | `#ffe4f0` | `#46193a` | Chips, selected nav, soft panels |
| `--brand` | `#ffb3d2` | same | Text selection, big soft blocks |
| `--apricot` (sun) | `#ffd23f` | same | Rare highlight; ink text on it |
| `--sage` (violet) | `#d2ccff` | same | Rare secondary block |
| `--good` / `--warn` / `--danger` | `#237a57` / `#8c5a13` / `#b53e49` | `#86d0aa` / `#ebbf80` / `#f1a1aa` | Status only |

- Logo pink `#ff3d8b` is for the n-square and big poster blocks (the `/brand`
  hero); text on it is white or ink at 24px and up. For text and buttons
  use `--accent` (`#d61f69`): it passes contrast.
- Checked contrast (WCAG): ink on blush 17.4:1, muted on blush 5.8:1,
  white on accent 4.9:1, accent on blush 4.7:1, dark accent on dark bg 7.1:1.
  White on logo pink is 3.3:1, so it is only for the icon.
- Green, amber and red mean status (paid, waiting, error). Never decoration.
- Dark mode is required: every new color needs a dark value, set in the
  three places `tokens.css` already uses (`prefers-color-scheme`,
  `[data-theme="dark"]`, embeds).

## Typography

One family: **Geist** (400–800) for logo, headings and text; **Geist Mono**
(400–500) for amounts, counts, times and codes. Files are self-hosted in
[`web/public/brand/`](web/public/brand/) (license:
[`LICENSE-geist.txt`](web/public/brand/LICENSE-geist.txt)); no Google Fonts
request at runtime. Fonts cover Latin, Latin Extended and Cyrillic.

| Role | Size | Weight | Tracking | Example class |
|---|---|---|---|---|
| Logo | SVG 26px tall (header; 24px on phones) | 800 outlines | -0.04em | `.gc-brand` + `Logo.tsx` |
| Page title | clamp(1.85rem, 4vw, 2.75rem) | 600 | -0.045em | `.gc-page-title` |
| Event title | clamp(1.9rem, 4vw, 2.6rem) | 600 | -0.045em | `.gc-event-title` |
| Landing hero | clamp(52px, 5.25vw, 76px) | 600 | -0.055em | landing `h1` |
| Body | 16px (landing 17px), line-height 1.55 | 400 | 0 | `body` |
| Label | 0.85rem | 500 | 0 | `.label` |
| Eyebrow | 0.75rem, UPPERCASE, accent color | 600 | 0.12em | `.gc-eyebrow` |

- Headings use `text-wrap: balance` and tight negative tracking.
- Title Case for navigation tabs, menu items and short button labels
  ("Explore", "My Events", "Create Event", "Sign In"); sentence case for
  headings and running text.
- Money and numbers in Geist Mono with tabular figures: `12.50 USDC`, `24 going`.

## Layout

- Content width: app `max-width: 1088px` with 24px side padding
  (`.gc-main`); landing 1240px. Phone gutter 20–24px, no horizontal scroll.
- Spacing on a 4px grid. Common steps: 8, 12, 16, 24, 48 px. Tailwind
  `gap-2`, `gap-3`, `p-4` are the usual ones.
- Header: sticky, 76px tall, blurred blush background, bottom hairline.
- Touch targets at least 44px tall (buttons 44px, inputs 46px).
- Mobile first: check every screen at 390px width.
- One screen = one idea on marketing pages. Few words, no feature lists.

## Elevation & Depth

Mostly flat: surfaces are separated by a 1px `--border`, not shadows.

- Menus and popovers: `box-shadow: 0 12px 32px #1e0b2b12`.
- Large forms: `box-shadow: 0 20px 60px #1e0b2b05` (barely visible).
- No heavy drop shadows, no glassy gradients, no neon glow.

## Shapes

Soft and round, like a party sticker.

- Pills (`9999px`): nav links, chips, account button, switches, landing buttons.
- 12px: app buttons and inputs (`.btn`, `.input`, `.lu-field`).
- 16px: menus, mode icons. 20px: cards (`.card`). 24px: choice cards.
  28px: the create form. Landing photo frames use an arch: `180px 180px 28px 28px`.
- Only the n-square is tilted (`-4deg`, in the icon and the logo); don't tilt UI or the word.

## Components

Use the classes in [`web/src/app/globals.css`](web/src/app/globals.css)
before writing new styles.

- **Buttons** `.btn` + one of: `.btn-primary` (ink, the default main action),
  `.btn-accent` (pink, the money moment: pay deposit, buy ticket, create
  event), `.btn-ghost` (secondary), `.btn-good` (success follow-up). One
  accent button per screen. Press: `scale(.98)`.
- **Inputs** `.input` with a `.label` above. Focus: accent border.
- **Cards** `.card`: surface, 1px border, 20px radius.
- **Chips** `rounded-full bg-accent-soft text-accent text-xs font-medium px-2 py-0.5`.
- **Switch** `.gc-switch` (`.gc-switch-sm` for inline use).
- **Focus ring**: 2px accent outline, 4px offset (set globally).
- **Tooltips**: SL UI deposit tooltip in
  [`web/src/components/sl-ui/`](web/src/components/sl-ui/).
- **Embed widget** (`<near-event>` on other sites) takes the host site's
  font, accent and radius; see [`docs/EMBED.md`](docs/EMBED.md). Keep it neutral.

## Do's and Don'ts

Do:
- Use tokens and existing classes; support light and dark.
- Keep copy short and plain; say exactly where the money is and what happens next.
- Use real product screenshots, real event photos or ready free-license art.
- Keep the guest's next action obvious: one primary button.
- Respect `prefers-reduced-motion`.

Don't:
- Don't draw illustrations, charts or fake UI by hand in SVG or CSS; it looks AI-made.
- Don't show "testnet", network badges or chain jargon in the UI.
- Don't add new colors, fonts or font weights without a decision in `DECISIONS.md`.
- Don't use the old palettes (lavender "Good company" `#5b4bff`, blue
  `#5B8CFF`) or the old fonts (Bricolage Grotesque, DM Sans).
- Don't put another brand's logo or name in front of ours (event themes are opt-in).
- Don't write FAQ walls, feature museums or long explainer sections on landing pages.

## Logo & Assets

The logo is **[n]earvent**: the first n sits in the pink square from the
icon (tilted -4deg, the n fills 56% of its height), then "earvent" in
Geist 800, ink on light and blush on dark (Alex, 2026-11-12). Only the first
n is boxed; never box or color any other part ("vent" alone reads like
"ventilation"). In the app the header draws it inline with
[`Logo.tsx`](web/src/components/Logo.tsx) (word in `currentColor`, so it
follows dark mode); use the files below everywhere else. The public brand
page is `/brand` (logo downloads, colors, type, voice, avatar and a prompt
for AI tools), linked from the footer.

The idea, in one line each: the square is a saved seat (a deposit holds
your spot); the n is for near (people in one room, NEAR holding the money);
the tilt is a sticker stuck on by hand (a party, not a bank).

| File (`web/public/brand/`) | Use |
|---|---|
| `nearvent-logo.svg` / `.png` | Logo on light backgrounds |
| `nearvent-logo-dark.svg` / `.png` | Logo on dark backgrounds |
| `nearvent-logo-white.svg` / `.png` | Logo on logo pink: white square, pink n, white word |
| `nearvent-icon.svg` / `.png` | Tilted pink square with the n (small spaces) |
| `nearvent-avatar.svg` / `.png` | Full-bleed pink square with the n (X, Telegram, profiles; 400×400 PNG) |
| [`favicon.ico`](web/src/app/favicon.ico), [`icon.svg`](web/src/app/icon.svg), [`apple-icon.png`](web/src/app/apple-icon.png) | Browser and home-screen icons; the Apple icon is the full-bleed avatar |

Public URLs: `/brand/<file>` (for example `/brand/nearvent-logo.svg`) and `/favicon.ico`.

Letters in the SVG files are outlines (no font needed). Rules: keep half
the square of empty space around the logo; at least 20 px tall, smaller
than that use the icon; don't recolor, stretch, tilt further or add
effects; don't drop the square; no busy photos behind it; don't write
"Nearvent" in another font as a logo. In text the name is written
**Nearvent** (one word, capital N).

## Voice & Copy

- Plain words, short sentences, active voice. Talk to the reader ("you").
- Lead with the person and the event; the blockchain stays in the background
  ("NEAR handles the money", not "trustless on-chain escrow").
- Be exact about money: deposit vs ticket, when it comes back, who gets the
  no-shows' share. Never promise "earn" or "win".
- Product words (use exactly): **Nearvent**, **deposit**, **Stake to RSVP**,
  **Ticket**, **Free**, **Going**, **I was there**, **check-in**, **QR pass**,
  **host**, **door team**, **USDC**.
- UI and docs are in English. Landing copy examples: "You never know who
  will show up." / "Put skin in the game." / "Your next event
  starts here."

## Imagery

- Photos: people at real meetups, faces and interaction, warm light. Interim
  photos and the shot list are in
  [`web/public/landing/MEDIA.md`](web/public/landing/MEDIA.md).
- Illustrations: the existing set in
  [`web/public/landing/illustrations/`](web/public/landing/illustrations/)
  (each has a `-dark` version). New ones come from ready free-license sources
  (unDraw, CC0 photos), recolored to the palette.
- Icons: [Lucide](https://lucide.dev) line icons (ISC license) in `currentColor`,
  16px next to nav labels (see `NavLabel` in
  [`Header.tsx`](web/src/components/Header.tsx)); token logos in
  [`web/public/landing/icons/`](web/public/landing/icons/).
- Web images: WebP/AVIF around 1600px wide; credit sources next to the files.

## Motion

- Easing: `--ease-out` `cubic-bezier(.23, 1, .32, 1)`; drawers `--ease-drawer`
  `cubic-bezier(.32, .72, 0, 1)`.
- Duration 140–220ms for UI; closing is faster than opening.
- Animate `transform` and `opacity` only. Text is readable on the first frame.
- With `prefers-reduced-motion: reduce`, keep only short fades.

## Event themes

Hosts can dress an event page in a theme (Ethereum, NEAR, Claude, Paradise
and others) from [`web/public/event-themes/`](web/public/event-themes/)
(credits: [`ATTRIBUTION.md`](web/public/event-themes/ATTRIBUTION.md)).
A theme changes only the event's cover, background, font choice and colors
inside the event area. The header, checkout, wallet steps and Manage pages
always use the brand tokens. Theme choices are stored off-chain, never in
the contract. Theme list and colors: [`web/src/lib/event-visuals.ts`](web/src/lib/event-visuals.ts).

Nearvent's own themes (group `near-me` in code; Studio is the default,
then Violet, Sun, Afterhours, Paper, Photo) use only brand colors: blush,
pink, violet, sun and ink. They keep the brand font, and their poster shows
the `nearvent` wordmark. Theme ids (`garden`, `sunset`, ...) stay as they
are because saved events point to them; only names and colors changed.
