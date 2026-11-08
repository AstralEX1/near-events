# Web app hosting and escrow release

Current status (2026-11-08): Vercel project `near-me-testnet` is linked from
`web/`; the hosted `/e/4` flow last passed on 2026-11-07 with faucet-USDC
registration, host-only event-detail save to Upstash, and off-chain check-in.
It uses the Upstash Redis database `NearMeTestnet`.
PR #21's TP5 contract was separately deployed and verified on a disposable
testnet account; its state layout is incompatible with TP4. The Vercel app
still targets TP4. No contract upgrade, app-default switch, or mainnet release
has happened. Upstash reported `NearMeTestnet` active on 2026-11-08. A local
request that day could not resolve the Vercel hostname because this environment
had no DNS/network access, so live uptime was not rechecked. Hosted secret
values are intentionally not documented here.

## Vercel setup reference

The current project is linked from `web/` and was deployed manually. Use these
steps when setting up or relinking a Vercel project:
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

Telegram bot work is outside the current project scope. Existing code and
historical data remain parked; do not configure a bot token or webhook. Web
check-ins, co-hosts and public event details use Upstash separately.

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
   check the target RPC again before upgrading the SDK or releasing. This
   read-only code-hash check does not replace transaction-based behavior checks.
4. On 2026-11-07, transaction and local UI checks passed on `tp4`: the UI created
   event 1, bought a 0.1 test-USDC ticket, confirmed the guest registration, and
   reopened the QR through `/e/1` and `/p/1`. Event 0 was finalized and its 1 USDC
   payout withdrawn to Intents. The ERC-191 registration and relayed-refund smoke
   passed on event 2. The direct ticket smoke script timed out waiting for an RPC
   receipt, but read-only chain views confirmed its registration and pool. A
   separate hosted check on event 4 then verified the Vercel app, Upstash save,
   host-authorized event details, faucet-USDC registration, and off-chain
   check-in. See the current deployment status above.
5. Before enabling mainnet cross-chain payments, verify 1Click credits the
   guest's Intents account, the wallet signs registration and the escrow records it.
   Repeat with ERC-191 through the app relayer. Verify that a rejected registration
   leaves the guest's funds accessible and that payout success, failure and
   refund agree with the final balance and receipt status.


## PR #21 testnet QA

Tested on 2026-11-07 by Codex against the PR head 4d0c93eb7e11dc9b481cc428996e95d7f1e19a68 in a separate worktree. GitHub Actions run 42367737200 passed web, contracts, and escrow-wasm. The downloaded artifact was built from that commit; its SHA-256 is 8107a7f92098e79aa1522a853adec0a950977ba4a463bfd8c2e8c5bd6508c387. Its NEAR code hash is 9ggN7z1oTekunzEceJGv6ufRwaW6smrfiUGNSt2HeRRG, matching the deployed code on escrow-tp5.tp5-codex-qa-20261107-a.testnet.

The disposable deployment used usdc.tidepool-sandbox.testnet, verifier.tidepool-sandbox.testnet, and a fresh test relayer. Test accounts were tp5-codex-qa-20261107-a.testnet, host-b.tp5-codex-qa-20261107-b.testnet, guest-1.tp5-codex-qa-20261107-b.testnet, guest-2.tp5-codex-qa-20261107-b.testnet, guest-3.tp5-codex-qa-20261107-b.testnet, guest-4.tp5-codex-qa-20261107-b.testnet, stranger.tp5-codex-qa-20261107-b.testnet, and relayer.tp5-codex-qa-20261107-b.testnet. No credentials are recorded here.

| Handoff cases | Result | Testnet transaction evidence |
|---|---|---|
| #1–6, #8: Deposit schema, capacity/deposit bounds, third-party guest, overpayment, full capacity, duplicate | Passed. Event 7 exposed only title/start/end metadata; 0.5 USDC overpayment returned; full-capacity and duplicate payments were refunded. | [create event 7](https://testnet.nearblocks.io/txns/FWzqqaXWtx22WEryU6SoZ1Az7jyEv4Ne2ovoQiLJBKmP), [guest registration](https://testnet.nearblocks.io/txns/4x4XzdYvm1fKFBGwPoCcK2kiTFXPqkFq68kb742m14bz), [capacity bound](https://testnet.nearblocks.io/txns/4pjQtQsi5Hs1Ft9AzPnEdNRPKwbBsSMnXHmy5LskPvP), [deposit bound](https://testnet.nearblocks.io/txns/AXJUhaNqu7HF2u6iTvH9zA8DVRCahUBxdfUX4JS7yV9n), [full-capacity refund](https://testnet.nearblocks.io/txns/EqZDQCdEkQH4m6faP7obvDhqVR3fBcNHTXRTtp8cpwdT), [duplicate refund](https://testnet.nearblocks.io/txns/45LwKoNDuYoRsSCwXZB4hXL7b2R83iMSRDBCfQ6xUoBY) |
| #9: Five-open-event cap and host independence | Passed. A’s sixth open event failed, B created independently, then A created after cancelling one. All test events were closed. | [sixth-event rejection](https://testnet.nearblocks.io/txns/4bTAAdG1jCYnCgXLikHov8tWuoLXwNo1kL7xRjwDqSdM), [host B event](https://testnet.nearblocks.io/txns/CtYtu5behKM3YzCHxhyUc4HMuAdJkxhTEuvukDnSdwqr), [released slot](https://testnet.nearblocks.io/txns/6NtQ7WaXW5kbLcwxi8ruRAKAySFAPAna4kimDMe4v8Bb) |
| #10, #12–13, #20, #25: Deposit settlement, host authorization, closed-event refund and views | Passed. Event 15 split 3,000,003 units between two attendees at 1,500,001 each and credited the 1-unit remainder to A. Unknown and non-host finalize attempts failed; post-close registration was refunded. Pagination, status batching, limits, recent-event ordering/cap and unknown-account balance passed. | [event 15 registrations](https://testnet.nearblocks.io/txns/8t2NgXTTGoTRs5kq3oAybvn7exEwVeGWekrRSqcUc33L), [finalize and payout log](https://testnet.nearblocks.io/txns/3rkMbZ4hnrjZZJ9ifQBPV2a79ShRZKVrfRwWo2MrXkfD), [post-close refund](https://testnet.nearblocks.io/txns/75usStenLt5Z1naCpd1aJPBAm5TNUDarxtJPUPQ8YKqG) |
| #11, #15: Empty Deposit finalization and early Deposit finalization | Passed. Empty attendance refunded the guest; Deposit finalization before start was allowed. | [empty Deposit finalize, event 18](https://testnet.nearblocks.io/txns/EqAFTY1HnhaX67JQCv29mi2CDRefeAjUqnzN4wLgo4y2) |
| #14: Ticket timing and payout | Passed. Event 21 rejected finalize before start, then paid 1 USDC to the host after start regardless of attendance. | [early finalize rejection](https://testnet.nearblocks.io/txns/6VooVfoJjShHceGWVQ2eb54vKDFvA6xe4XarobUX8fXE), [successful finalize](https://testnet.nearblocks.io/txns/74DcnmW4s34ciefRW4DjtSoTRS3CkS2GMieNnDD33JDy) |
| #16–19: Host cancel, exact 1 yocto, stranger before and after grace | Passed. Host cancel refunded; missing yocto and pre-grace stranger cancel failed; stranger cancelled the event ending 31 days earlier and refunded its guest. | [host cancellation](https://testnet.nearblocks.io/txns/2jMuDSuar1VkToMQgu4B4E3AtuJGvndk1DXjBzpMqskP), [missing-yocto rejection](https://testnet.nearblocks.io/txns/7EhoL5UEYSyWLBLcTjiqMYnW7vKiGq5wyDYBvvGEr3rr), [stranger denied before grace](https://testnet.nearblocks.io/txns/4mV3eF1vo2JbCTrZ2DVwFGtbzBWtbzAwvGdVQuQLtQ94), [stranger recovery after grace](https://testnet.nearblocks.io/txns/HMgab49nedCbVohvkkFdU8YmeuvZNBfTzHkxFStY7K1b) |
| #21: Wallet withdrawal and invalid amounts | Passed. Zero and over-balance amounts failed; exact payout reached the guest’s USDC wallet and reduced the internal balance. | [wallet withdrawal](https://testnet.nearblocks.io/txns/HYTop2aVUrs3aaYD9V7Aedgs9U1nW9MHn8gGeRAVFUzk) |
| #22–23: Direct Intents withdrawal and relayer payout | Passed against the real Tidepool sandbox verifier. Guest self-withdraw credited their own Intents balance; configured relayer payout succeeded and stranger payout failed. | [direct Intents withdrawal](https://testnet.nearblocks.io/txns/42esfXRGgtKJARK8a6P1eTpmnvYF3STjMr36dnEHbpWM), [relayer payout](https://testnet.nearblocks.io/txns/5DnUtCs4yVi5oZdLUpo7ENQ5oLg1dsrWk2nkvHh2G3N7), [unauthorized payout rejected](https://testnet.nearblocks.io/txns/132Ec9oswDtaeqzPV5brBD7j17dDm1he1aj8LbNZN7VE) |
| W5, W8: Server-side door-team and check-in authorization | Passed on event 22 against the PR worktree. Host saved and removed D; no token returned 401, stranger received 403, D checked in the registered guest, and D’s pre-removal token received 403 after removal. The host finalized the checked-in guest. | [event 22 creation](https://testnet.nearblocks.io/txns/9NcgEGqn6BP3g8DiGaFzVgZEwekgBswqT3t7agSwrunE), [guest registration](https://testnet.nearblocks.io/txns/QQEFuEmmBrjrBTH6MccrGBoDANrS6x2yAhEGuXggXqy), [finalize after check-in](https://testnet.nearblocks.io/txns/BAwNmSLB6usD4CWy7Z3HhjwRGRgknZxh6BB5k9Vv2jit) |\n| #24: Removed ABI methods | Passed. Calls to set_paused, update_event, refund_guest, refund_if_abandoned, and cleanup_event, plus the removed views, returned MethodNotFound. | [set_paused](https://testnet.nearblocks.io/txns/8JT9JhfsnBfJMSnPFdkyQxTpasjLAu663WGV3peiJEFP), [update_event](https://testnet.nearblocks.io/txns/3Wwk7sR6oqjWTiZBVM6SYViiLDvifWvckqTetBJFcatT), [refund_guest](https://testnet.nearblocks.io/txns/FjKtH1UPXeQsVc1924PqxBAD2D47nYoTHi6Knk1yTx5H), [refund_if_abandoned](https://testnet.nearblocks.io/txns/8Ym3MJiDmpVMDRcR4cSgFexq31nhPVwtnYVM9VXGz5Mx), [cleanup_event](https://testnet.nearblocks.io/txns/AwMjcr6NZtN76eqAiPu1VFmPWdZkXxpbZRLJa4KpoYuE) |

The Tidepool 1Click smoke also passed through test USDT → Intents USDC → registration, duplicate-payment refund, and split cross-chain/Intents payout. The script confirmed successful delivery and balances, but did not record transaction hashes.

Local verification: node --test tests/*.test.mjs passed 19/19, including door-team input validation. The smoke scripts now wait for eventual RPC state and compare balance deltas so previous disposable test balances do not invalidate a run. In the PR worktree, /e/21 rendered the finalized Ticket as “Paid out”; /e/22 showed the host and off-chain door-team member, then after removal showed no door member and rendered the checked-in guest as paid out. Signed disposable accounts passed /api/cohosts and /api/checkin authorization, add/remove, and stale-token rejection. /create and /create?flow=widget loaded; without a connected wallet, Continue remained disabled even for a valid amount. Wallet-driven creation, on-screen Door team validation hints, the Manage edit/cancel controls, and /me and /u aggregation were not exercised. Telegram bot flows are outside scope and were not tested.

The wrong-token case (#7) was not run because it requires a second escrow initialized with a separate test token. The 1,000-event limit (#26) was not run, as directed. The account default in web/src/lib/config.ts remains escrow-tp4.nearevents-11022103.testnet; no mainnet or real-money flow was used. This QA report is kept here as the verification record for PR #21; no separate PR comment was posted.
