# Rehearsal: Near Me full journey

Design reference: the actual Near Me app shell and screens. The scene reuses the `HeaderPreview` shell and public event components `VisualBackdrop`, `EventPoster`, `DateBadge`, `Avatar`, `StatusPill`, and `AccountQr`. Registration, Manage, and cash-out controls are non-interactive sample UI patterned after the app components so the demo cannot trigger wallet or camera actions.

Scene: `http://127.0.0.1:3001/try`. The scene is illustrative sample UI. It makes no wallet, chain, storage or scanner calls and uses no real attendee or transaction data.

Visual system: uses the app's existing Geist/Geist Mono fonts, CSS color tokens, surfaces, borders, cards, buttons, and navigation; no separate demo font or palette was introduced.

Beats: show a 10 USDC refundable deposit → reveal `kai.mori.near`'s QR pass → host opens Guests and confirms the scanned guest → close the ended event → show the app's open withdrawal form for a 15 USDC balance. Ten checked-in guests split the 150 USDC pool. The UI is illustrative and does not perform a withdrawal.

Composition: wide uses the 880×600 Stageshow browser showing the Near Me event and Manage screens. Compact uses the 358×682 responsive web screen with the same app header and cards. The guest page stacks its cover, host, and attendees as the real page does, then the staged story scrolls to registration. There is no device frame or app-only navigation.

## Visual review

- The app-native demo was inspected in the in-app browser in compact dark mode. The visible journey uses the event page, logged-in guest/host header states, QR pass, host check-in screens, and the open withdrawal form with the app's native destination select.
- The earlier faux-phone screenshots and their gate results are superseded by this app-native redesign.
- The in-app browser loaded `http://127.0.0.1:3001/try` and showed the compact event, Manage, check-in, and payout states. The page is a local development preview, not a hosted deployment.
- The Stageshow film gate could not capture the revised scene: `film.mjs` exited 2 because no Chrome/Chromium executable was available. No updated wide-state or automated motion gate is claimed.
- `./node_modules/.bin/tsc --noEmit --pretty false` and `git diff --check` passed after the final source edits.

## Fresh-eye review

The first app-native review identified compact cover visibility, QR generation, header reuse, the cash-out form, and host-list details to align. A follow-up found and fixed the queued check-in remaining after success, the close action targeting an already-closed state, the missing destination-select affordance, and stale pre-close copy. The final read-only review confirmed the story and payout copy are consistent.

## Build and limits

- `npm run build` was attempted. The default Turbopack run did not finish; the webpack build could not resolve `next/font/google` because this sandbox could not reach Google Fonts. Font configuration was left unchanged, so a production build is not verified.
- `./node_modules/.bin/tsc --noEmit --pretty false` passed after the final app-native screen changes.
- No unit tests were run. The revised Stageshow film and layout gates remain pending because the required Chrome binary is unavailable.
- Touch hardware, actual wallet/chain/storage flows, real QR scanning, other browsers, and production deployment were not checked.
- Earlier film-sampling gaps and layout results apply to the superseded faux-phone scene only.
