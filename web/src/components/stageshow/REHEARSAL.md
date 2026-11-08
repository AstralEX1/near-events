# Rehearsal: Near Me full journey

Design reference: the actual Near Me app shell and screens. The scene uses the public event page's `VisualBackdrop`, `EventPoster`, `DateBadge`, `Avatar`, and `StatusPill` components, and follows the existing `Header`, `RegistrationCard`, and Manage page layout. The compact view is the web app at the registration section; there is no device frame or app-only bottom navigation.

Scene: `http://127.0.0.1:3001/try`. The scene is illustrative sample UI. It makes no wallet, chain, storage or scanner calls and uses no real attendee or transaction data.

Visual system: uses the app's existing Geist/Geist Mono fonts, CSS color tokens, surfaces, borders, cards, buttons and control styling; no separate demo font or palette was introduced.

Beats: show a 10 USDC refundable deposit → reveal `kai.mori.near`'s QR pass → check in that same guest → close the ended event → show a 15 USDC balance ready to withdraw. Ten checked-in guests split the 150 USDC pool. The UI is illustrative and does not perform a withdrawal.

Composition: wide uses the 880×600 Stageshow browser showing the Near Me event and Manage screens. Compact uses the 358×682 responsive web screen with the same app header and cards; the guest page is positioned at its registration section so the action and pass are visible.

## Visual review

- The in-app browser on `/try` was inspected after the redesign in compact dark mode. The scene shows the actual Near Me header, event detail and registration card, and the 15 USDC payout result. The registration screen was visible after replay; the reduced-motion poster showed the payout.
- The demo page returned 200 and Next.js compiled the updated module in the local dev session.
- The Stageshow film gate could not capture the revised scene: `film.mjs` exited 2 because no Chrome/Chromium executable was available. No updated wide-state or automated motion gate is claimed.
- The earlier faux-phone screenshots and their gate results are superseded by this app-native redesign.
- `git diff --check` passed after the redesign.

## Fresh-eye review

The earlier review covered the now-superseded faux-phone scene. A fresh read-only review of the app-native version is pending.

## Build and limits

- `npm run build` was attempted. The default Turbopack run did not finish; the webpack build could not resolve `next/font/google` because this sandbox could not reach Google Fonts. Font configuration was left unchanged, so a production build is not verified.
- `tsc --noEmit` reported one unrelated error in `src/components/DepositRulesTooltip.tsx:98`; it reported no diagnostics in the staged demo.
- No unit tests were run; this presentation-only plan uses the Stageshow film and layout gates.
- Touch hardware, actual wallet/chain/storage flows, real QR scanning, other browsers, and production deployment were not checked.
- Film sampling had timing gaps while Chrome captured screenshots; no remaining motion/layout findings were reported in the final full-state runs.
