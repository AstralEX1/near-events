# Nearvent — Party poster brand

The full brand book (colors, type, logo rules, voice, imagery) is
[`DESIGN.md`](../../../DESIGN.md) at the repo root. This folder holds the files
it points to.

- `tokens.css` — color and font variables shared by the landing and the app.
  Change a value here and in `DESIGN.md` in the same commit.
- `fonts.css` + `geist-*.woff2`, `font-7.ttf`, `font-8.ttf` — self-hosted Geist
  400–800 (latin, latin-ext, cyrillic) and Geist Mono 400–500, from Google Fonts
  on 2026-11-10. License: `LICENSE-geist.txt` (SIL OFL). No external font service.
- `nearvent-logo.svg`, `-dark.svg`, `-white.svg` (+ `.png`, 400 px tall) — the
  [n]earvent logo for light, dark and logo-pink backgrounds; letters are
  outlines of Geist 800, so no font is needed. `web/src/components/Logo.tsx`
  is the same drawing inline for the header.
- `nearvent-icon.svg` (+ 1024 px `.png`) — tilted pink square with the n.
  `favicon.ico` and `icon.svg` in `web/src/app/` come from it.
- `nearvent-avatar.svg` (+ 400 px `.png`) — full-bleed pink square with the n
  for profiles; `web/src/app/apple-icon.png` comes from it.
- The public page that hands these out is `/brand`.
