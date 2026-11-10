# Nearvent — Party poster brand

The full brand book (colors, type, logo rules, voice, imagery) is
[`DESIGN.md`](../../../DESIGN.md) at the repo root. This folder holds the files
it points to.

- `tokens.css` — color and font variables shared by the landing and the app.
  Change a value here and in `DESIGN.md` in the same commit.
- `fonts.css` + `geist-*.woff2`, `font-7.ttf`, `font-8.ttf` — self-hosted Geist
  400–800 (latin, latin-ext, cyrillic) and Geist Mono 400–500, from Google Fonts
  on 2026-11-10. License: `LICENSE-geist.txt` (SIL OFL). No external font service.
- `nearvent-wordmark.svg`, `nearvent-wordmark-dark.svg` — the logo for light
  and dark backgrounds; letters are outlines of Geist 800, so no font is needed.
- `nearvent-icon.svg` — square mark (tilted pink pill with "n"). The app's
  `favicon.ico`, `icon.svg` and `apple-icon.png` in `web/src/app/` come from it.
