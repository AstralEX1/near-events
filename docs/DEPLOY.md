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
| `NEXT_PUBLIC_EVENTS_CONTRACT` | `escrow-tp2.nearevents-11022103.testnet` | no |
| `NEXT_PUBLIC_USDC_CONTRACT` | `usdc.tidepool-sandbox.testnet` | no |
| `RELAYER_ACCOUNT_ID` | `relayer-nearevents-11022103.testnet` | no |
| `RELAYER_PRIVATE_KEY` | from `web/.env.local` (paste in Vercel only) | **yes** |
| `ONECLICK_API_KEY` | optional | **yes** |

3. FastAuth (Google/email): the shared testnet Auth0 client only accepts
   approved callback URLs. Localhost works; a Vercel domain may need its own
   client (docs.auth.near.org → apply). Wallet and EVM login work
   anywhere.

For mainnet, switch the three `NEXT_PUBLIC_*` values to the mainnet escrow,
`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (USDC), and a
mainnet relayer.

The relayer routes are rate-limited in memory per instance; on serverless that
is best-effort, so keep the relayer funded with only a small amount of NEAR.
