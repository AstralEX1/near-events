# Hosting the web app (not done yet)

The testnet escrow deployment is recorded below. The Vercel hosting steps have
not been run. (2026-11-06, Codex)

## Vercel (recommended)
1. Import the public repo in Vercel, **Root Directory = `web`**, framework Next.js
   (defaults for build `next build` and output are fine).
2. Environment variables (Project → Settings → Environment Variables):

| Name | Testnet value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `testnet` | no |
| `NEXT_PUBLIC_EVENTS_CONTRACT` | `escrow-tp4.nearevents-11022103.testnet` | no |
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
Events and balances on older accounts are outside the app flow and are not
migrated.

The 2026-11-06 check found four events on the old
`escrow-tp3.nearevents-11022103.testnet`, including one open event with a guest
and 10 USDC. Its deployed code hash is
`5SH6L4aZBsiQMj8UHZW7GeHrPbXTJeTZyneh4oNfxMx3`; read-only RPC returned
254,164 bytes of deployed WASM. CI reproducibly built the current `fffd053`
candidate: its 268,797-byte WASM SHA-256 is
`026d9b19f697a7c81abcd10134c2ee2ac8fbfaac93590dc41a032ae5a0e6a361`, with
expected NEAR code hash `AUkadt9QEg7JQXMqsPZQgUQDoimi4U1VgGwfEYgG6QG`. The
code sizes and hashes differ. Alex confirmed these are disposable testnet data;
`escrow-tp3` was left untouched and is no longer used by the app.

The app now targets `escrow-tp4.nearevents-11022103.testnet`. CI run
`42233084526` built the 268,797-byte artifact from source
`b9079baa1e504fd2abfd240ab15d4d15f7fc0007`, SHA-256
`b9c30dd43327ff0e60c4655e3293c7adf03598115332e4eb2c38095913543606`, NEAR code
hash `DW8vzNr2zzAcrdCfvp2FyJfctSxiAkKcoxkgjbGpp4eH`. Read-only RPC confirmed the
deployed hash, `usdc.tidepool-sandbox.testnet`,
`verifier.tidepool-sandbox.testnet`, the relayer, and zero events. Tidepool USDC
storage registration also succeeded. The contract has about 2.30 NEAR available
for future storage commitments.

1. Build from the committed public source with cargo-near 0.22.0 and
   `cargo near build reproducible-wasm --manifest-path contracts/events/Cargo.toml`.
   The manifest pins the container digest. Record the source SHA and built artifact.
2. Deploy and initialize in one transaction. Set the correct token, Intents verifier
   and relayer, register escrow storage on the USDC contract, and fund the NEAR
   storage reserve for the planned number of simultaneous events. The testnet deploy
   script does these steps for a new sub-account; `tp4` already existed as an empty
   account, so it was deployed using that account's local key.
3. Verify the resulting contract code without sending a transaction:
   `node web/scripts/verify-escrow-code.mjs <wasm> <account> <rpc-url>`.
   A mismatch is a release blocker. Confirm the target chain supports the SDK's
   minimum protocol version before deploying. The current lockfile uses
   `near-sdk` 5.29.1 (minimum protocol 84); 5.30.0 requires protocol 88, so
   check the target RPC again before upgrading the SDK or releasing.
4. Before a hosted testnet demo, run the Tidepool and ERC-191 smoke scripts against
   the intended escrow and application. They assert delivery, registration and
   refunds. These live payment checks have not been run on `tp4`.
5. Before enabling mainnet cross-chain payments, verify 1Click credits the
   guest's Intents account, the wallet signs registration and the escrow records it.
   Repeat with ERC-191 through the app relayer. Verify that a rejected registration
   leaves the guest's funds accessible and that payout success, failure and
   refund agree with the final balance and receipt status.
