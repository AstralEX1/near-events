# Deploying the web app (not done yet)

Hosting is a plus for judging (keep it up until at least 2026-11-18). Nothing
below has been run; deploying needs Alex's OK. (2026-11-03, Claude)

## Vercel (recommended)
1. Import the public repo in Vercel, **Root Directory = `web`**, framework Next.js
   (defaults for build `next build` and output are fine).
2. Environment variables (Project → Settings → Environment Variables):

| Name | Testnet value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `testnet` | no |
| `NEXT_PUBLIC_EVENTS_CONTRACT` | `escrow-tp3.nearevents-11022103.testnet` | no |
| `NEXT_PUBLIC_USDC_CONTRACT` | `usdc.tidepool-sandbox.testnet` | no |
| `RELAYER_ACCOUNT_ID` | `relayer-nearevents-11022103.testnet` | no |
| `RELAYER_PRIVATE_KEY` | from `web/.env.local` (paste in Vercel only) | **yes** |
| `ONECLICK_API_KEY` | optional | **yes** |
| `APP_SECRET` | any long random string (signs staff-session tokens for check-ins and event-detail saves) | **yes** |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | an Upstash Redis database (door check-ins and public event details; Vercel's disk is wiped) | **yes** |
| `RATE_LIMIT_REDIS_URL` | shared Redis REST URL | no |
| `RATE_LIMIT_REDIS_TOKEN` | Redis REST token | **yes** |

3. FastAuth (Google/email): the shared testnet Auth0 client only accepts
   approved callback URLs. Localhost works; a Vercel domain may need its own
   client (docs.auth.near.org → apply). Wallet and EVM login work
   anywhere.

For mainnet, switch the three `NEXT_PUBLIC_*` values to the mainnet escrow,
`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (USDC), and a
mainnet relayer.

Hosted relayer and 1Click endpoints require shared Redis REST quotas. Use the
same Redis instance across replicas of the same environment. The endpoints reject
paid requests if the shared quota cannot be enforced.

## Escrow release

The audited storage changes require a fresh escrow account. The storage layout
of existing contracts is incompatible. The app uses one escrow account at a
time; it does not look up events or route withdrawals across older accounts.
Point the app at the release escrow only after the checks below pass. Events and
balances on older accounts are outside the app flow and are not migrated.

The 2026-11-06 release check found four events on the current
`escrow-tp3.nearevents-11022103.testnet`, including one open event with a guest
and 10 USDC. Its deployed code hash is
`5SH6L4aZBsiQMj8UHZW7GeHrPbXTJeTZyneh4oNfxMx3`; read-only RPC returned
254,164 bytes of deployed WASM. CI reproducibly built the current `867f6c0`
candidate: its 268,797-byte WASM SHA-256 is
`289bed7d5a650763fc23e8dc10fa5eec31cb75c9f0fda8b3785f99a29528f605`, with
expected NEAR code hash `3jXDFKaP3wENet5xCfU8W9VnGqBJxjpYpStmbxPJW1Dv`. The
code sizes and hashes differ. Do not upgrade this escrow or point the app at
another account until access to the open event and its funds is preserved.

1. Build from the committed public source with cargo-near 0.22.0 and
   `cargo near build reproducible-wasm --manifest-path contracts/events/Cargo.toml`.
   The manifest pins the container digest. Record the source SHA and built artifact.
2. Deploy and initialize in one transaction. Set the correct token, Intents verifier
   and relayer, and register escrow storage on the USDC contract. Fund the NEAR
   storage reserve for the planned number of simultaneous events. The testnet deploy
   script does these steps.
3. Verify the resulting contract code without sending a transaction:
   `node web/scripts/verify-escrow-code.mjs <wasm> <account> <rpc-url>`.
   A mismatch is a release blocker. Confirm the target chain supports the SDK's
   minimum protocol version before deploying. The current lockfile uses
   `near-sdk` 5.29.1 (minimum protocol 84); 5.30.0 requires protocol 88, so
   check the target RPC again before upgrading the SDK or releasing.
4. For testnet, run the Tidepool and ERC-191 smoke scripts against the intended
   escrow and application. They assert delivery, registration and refunds.
5. Before enabling mainnet cross-chain payments, verify 1Click credits the
   guest's Intents account, the wallet signs registration and the escrow records it.
   Repeat with ERC-191 through the app relayer. Verify that a rejected registration
   leaves the guest's funds accessible and that payout success, failure and
   refund agree with the final balance and receipt status.
