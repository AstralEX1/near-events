# Web app hosting and escrow release

Current status (2026-11-13): Vercel Production (`www.nearvent.site`) runs on
mainnet with the escrow `escrow.lold.near`, deployed 2026-11-11 with the tp7 code
(see "Mainnet release") and upgraded in place to v3 with no court on 2026-11-13
(the last section of this file); 0 events so far. Preview deployments, the app
default, `.env.example` and the local `.env.local` stay on testnet `escrow-tp7.tp7-nv1110.testnet` (see "TP7 testnet
deploy"); TP6/TP5/TP4 events remain on chain outside the app flow. Testnet USDC is
`usdc.tidepool-sandbox.testnet`, verifier `verifier.tidepool-sandbox.testnet`.
Upstash stores off-chain details keyed by contract id. Hosted secret values are
intentionally not documented here.

## Mainnet release

Everything below that spends real NEAR or USDC is Alex's to run: the deploy,
funding the accounts and the paid checks. Claude prepared the code, scripts and
read-only checks. Alex ran the escrow deploy on 2026-11-11 (step 3) and Production was
switched to mainnet the same day (step 5); the paid checks and the whitelist are still open.

**What is ready (2026-11-10).**
- `web/src/lib/config.ts`: with `NEXT_PUBLIC_NETWORK=mainnet` the app uses native
  USDC `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`,
  `intents.near`, `rpc.mainnet.fastnear.com`, `nearblocks.io` and live 1Click
  swaps. `NEXT_PUBLIC_EVENTS_CONTRACT` is required: the build stops without it, so
  a mainnet site can never fall back to the testnet escrow.
- NEAR Auth (Google/email): `fast-auth.near`, MPC `v1.signer`, issuer
  `login.auth.near.org`. Mainnet accounts hold no NEAR: the relayer creates each
  new account with 0.003 NEAR (its storage) and sends every action as a NEP-366
  meta-transaction (`/api/fastauth/relay`), paying its gas and its 1 yoctoNEAR
  deposit; it also pays USDC storage for 1Click cash-out addresses. Because the
  relayer would pay any deposit inside a meta-transaction, deposits above 1 yocto
  are refused: Google/email hosts get free-tier events only (like EVM hosts).
  Without `NEXT_PUBLIC_FASTAUTH_CLIENT_ID` the Google button is hidden (the shared
  testnet client does not work on mainnet).
- 1Click: `https://1click.chaindefuser.com`; `ONECLICK_API_KEY` is sent as
  `Authorization: Bearer` (without a key 1Click adds 0.25% per quote).
- The test USDC faucet is testnet-only and switches off by itself. The demo account
  runs only in the browser on made-up data, so it works on mainnet as well.
- Off-chain data (event details, free events, check-ins, door team, guest names,
  visuals) is keyed by escrow id, so it never mixes with testnet; profile keys get
  a `mainnet:` prefix. Still use a separate Upstash database for mainnet.
- Read-only check of the mainnet pieces passed on 2026-11-10
  (`NETWORK=mainnet node scripts/check-release.mjs`): protocol 88 (the escrow's
  `near-sdk` 5.29.1 needs 84), USDC with 6 decimals, `intents.near`,
  `fast-auth.near`, `v1.signer`, NEAR Auth JWT keys, 1Click token list with USDC
  and a dry quote (ETH on Base → 1 USDC in Intents).
- The Google meta-transaction path was checked on testnet through the app's
  routes with `scripts/smoke-meta-tx.mjs` (see "Meta-transaction testnet check").
  The Auth0 popup signing a delegate action was not tested: it needs a real Google
  login.

**1. Accounts (Alex).**
- Owner: a Ledger account. It can `upgrade` the code until `freeze` and run the
  host whitelist and the sponsored list; it cannot touch balances. Owner calls with a Ledger go through
  `near-cli-rs` (`… sign-with-ledger`); `scripts/escrow-owner.mjs` needs a key file.
- Deployer: an account with a key in `~/.near-credentials/mainnet/`. The escrow is
  created as `<NEW_ACCOUNT>.<deployer>`, for example `escrow.nearvent.near`. The
  older plan's key for `near-events.near` is in that folder, but the account was
  never created (checked 2026-11-10).
- Relayer: its own account; the key lives only in Vercel and the local
  `.env.local`. Start with at least 5 NEAR. Costs: about 0.001–0.003 NEAR per
  relayed call, 0.003 NEAR per new Google account, 0.00125 NEAR per USDC storage
  registration; quotas cap the relayer at 300 paid requests a day.

**2. Build.** Use the `escrow-wasm` artifact of the release commit's green CI run
(`cargo near build reproducible-wasm --manifest-path contracts/events/Cargo.toml`).
Record the commit, the artifact SHA-256 and the NEAR code hash here.

**3. Deploy** (two transactions: create the sub-account, then deploy + init + delete its key):

```bash
cd web
NETWORK=mainnet CONFIRM_MAINNET=yes DEPLOYER=<deployer>.near RELAYER_ACCOUNT=<relayer>.near \
  WASM=<path>/near_events.wasm node scripts/deploy-escrow.mjs
```

The owner defaults to the deployer (`OWNER=` to change it; it cannot be changed after
the deploy without a code upgrade, and neither can the relayer). Without a key file in
`~/.near-credentials/mainnet/` the script asks for the deployer's private key or seed
phrase (hidden, never saved). Before sending anything it checks that the accounts exist,
that the key is a full-access key of the deployer and that the balance covers the code; it
then shows a summary and waits for a typed `yes`. If the second transaction fails, it
deletes the new account and the NEAR goes back to the deployer (checked on testnet
2026-11-11: a failing `new` cost about 0.01 NEAR in gas).

NEAR in the escrow: the code (306,474 bytes at `0361b38`) locks about 3.07 NEAR; the
rest is the free-tier pool (a free 50-seat event reserves 0.287 NEAR while open, so 5 NEAR
covers about 17 open free events; NEAR sent to the escrow later adds to it). The script
suggests up to 8 NEAR. It then checks the code hash, `get_config` and the empty key list,
and registers the escrow's USDC storage (0.0125 NEAR from the deployer).

Testnet dry run of this exact WASM (2026-11-11): `dry-ok1111.tp6guest2-nv1110.testnet`
with 3.2 NEAR, key entered at the prompt; `check-release.mjs` passed.

**Mainnet deploy (2026-11-11, run by Alex).** `escrow.lold.near`, owner and deployer
`lold.near`, relayer `event_relayer.near` (not funded yet). WASM: CI `escrow-wasm` artifact
of `0361b38` (run 42952342637), SHA-256
`64e50a1a50efb49ab093715d3d1066f40da22855d25d89432b697f902f5d0693`, NEAR code hash
`7nrLLgzcUP1NUyUcKACekuq1EoEXWe5jW5a314HiVjm4`. 5.26 NEAR in the escrow (code storage
306,795 B ≈ 3.07 NEAR, ≈ 2.19 NEAR free-tier pool). Transactions: create
[`7kTGjWvnBGepRahJ3bPxziKpPA3sojG7Siavy6MG1qdo`](https://nearblocks.io/txns/7kTGjWvnBGepRahJ3bPxziKpPA3sojG7Siavy6MG1qdo),
deploy + `new` + delete key
[`Br4HMemQfN4WhqoVDchoPQ66XeWcis7onxxJB1gXeGt6`](https://nearblocks.io/txns/Br4HMemQfN4WhqoVDchoPQ66XeWcis7onxxJB1gXeGt6).
`check-release.mjs` passed every check except the relayer balance (0 NEAR); whitelist mode
is off and the code is not frozen.

**4. Check** (read-only):

```bash
NETWORK=mainnet EVENTS_CONTRACT=escrow.<deployer>.near RELAYER_ACCOUNT=<relayer>.near \
  OWNER=<ledger>.near WASM=<path>/near_events.wasm node scripts/check-release.mjs
```

**5. Switch the site** (on Alex's deploy command). Set the Vercel Production
variables from `web/.env.mainnet.example`: the mainnet escrow, NEAR Auth client id,
mainnet relayer account and key, a new `APP_SECRET`, a separate Upstash database,
`RATE_LIMIT_REDIS_*` (mainnet refuses relayer and 1Click requests without them) and
`ONECLICK_API_KEY`. Keep Preview on testnet so preview deployments never move real
money. Redeploy. For NEAR Auth, the Auth0 callback, origin and logout URL is
`https://www.nearvent.site`.

**Switched 2026-11-11.** Production variables: `NEXT_PUBLIC_NETWORK=mainnet`,
`NEXT_PUBLIC_EVENTS_CONTRACT=escrow.lold.near`, `RELAYER_ACCOUNT_ID=event_relayer.near` (set by
Claude); `RELAYER_PRIVATE_KEY` and `ONECLICK_API_KEY` (set by Alex). Kept on purpose: the shared
Upstash database (keys carry the escrow id; profiles get `mainnet:`), the existing Production
rate-limit Redis and `APP_SECRET` (staff tokens only prove an account; host rights are read
from the mainnet escrow). Checked after the build of `9151916`: pages answer 200,
`/docs/contract` shows `escrow.lold.near` and the code hash, the feed is empty, no console
errors, `/api/oneclick/tokens` lists 229 mainnet tokens and a dry quote through
`/api/oneclick/quote` returned 1 USDC ≈ 0.00049 ETH on Base. Not checked: the relayer key
(only a relayed action proves it; `smoke-meta-tx.mjs` costs about 0.01 NEAR).

Whitelist (owner, same key prompt as the deploy):

```bash
cd web
NETWORK=mainnet OWNER=lold.near EVENTS_CONTRACT=escrow.lold.near node scripts/escrow-owner.mjs add <host>.near
NETWORK=mainnet OWNER=lold.near EVENTS_CONTRACT=escrow.lold.near node scripts/escrow-owner.mjs mode on
```

**6. Release checks with small real amounts (Alex, about 2 USDC).**
- `NETWORK=mainnet APP_URL=https://www.nearvent.site EVENTS_CONTRACT=… node scripts/smoke-meta-tx.mjs`:
  a new implicit account creates and cancels a free event, paying no gas
  (≈0.01 NEAR from the relayer).
- NEAR wallet: create a free event, pay 0.1 USDC from another chain on the pay page
  (1Click → Intents → Confirm registration), check in, close, withdraw to Intents
  and to another chain.
- EVM wallet: register from the Intents balance, close, payout to Intents, cash out.
- Google/email: sign in, register, then host cancels and the refund is withdrawn.
- Ticket: buy a ticket, host withdraws after the event starts.
- A rejected registration (event full) leaves the USDC in the guest's Intents balance.

**7. After the checks.** Record the transaction hashes here, add the best ones to
the `PROOF` list in `web/src/app/(site)/docs/contract/page.tsx`. Before real users
see the escrow, the owner turns the whitelist mode on and adds verified hosts:
the host decides who came, so deposits and tickets only go to hosts we trust.
Decide whether the sponsored mode is on too. `freeze` only once the code is final.

**Rollback.** Put the testnet variables back in Vercel and redeploy. Funds stay in
the mainnet escrow; guests can still `withdraw` with any NEAR tool, and the site
can point at the same escrow again later.

## Vercel setup reference

The current project is linked from `web/` and was deployed manually. Use these
steps when setting up or relinking a Vercel project:
1. Import the public repo in Vercel, **Root Directory = `web`**, framework Next.js
   (defaults for build `next build` and output are fine).
2. Environment variables (Project → Settings → Environment Variables):

| Name | Testnet value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_NETWORK` | `testnet` | no |
| `NEXT_PUBLIC_EVENTS_CONTRACT` | `escrow-tp7.tp7-nv1110.testnet` | no |
| `NEXT_PUBLIC_USDC_CONTRACT` | `usdc.tidepool-sandbox.testnet` | no |
| `RELAYER_ACCOUNT_ID` | `relayer-nearevents-11022103.testnet` | no |
| `RELAYER_PRIVATE_KEY` | from `web/.env.local` (paste in Vercel only) | **yes** |
| `ONECLICK_API_KEY` | optional (1Click JWT, sent as `Authorization: Bearer`) | **yes** |
| `APP_SECRET` | any long random string (signs staff-session tokens for check-ins and event-detail saves) | **yes** |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | an Upstash Redis database (door check-ins and public event details; Vercel's disk is wiped) | **yes** |
| `RATE_LIMIT_REDIS_URL` | shared Redis REST URL | no |
| `RATE_LIMIT_REDIS_TOKEN` | Redis REST token | **yes** |

3. FastAuth (Google/email): the shared testnet Auth0 client only accepts
   approved callback URLs. Localhost works; a Vercel domain needs its own
   client (docs.auth.near.org → apply), set as `NEXT_PUBLIC_FASTAUTH_CLIENT_ID`.
   Wallet and EVM login work anywhere.

Telegram bot work is outside the current project scope. Existing code and
historical data remain parked; do not configure a bot token or webhook. Web
check-ins, co-hosts and public event details use Upstash separately.

For mainnet, use `web/.env.mainnet.example` and the "Mainnet release" steps above.

Hosted relayer and 1Click endpoints require shared Redis REST quotas. Use the
same Redis instance across replicas of the same environment. The endpoints reject
paid requests if the shared quota cannot be enforced.

## Escrow release

Historical (2026-11-06, testnet tp3 → tp4). Mainnet v3 is an in-place upgrade
instead; see the last section. The build and verify steps below still apply.

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


## PR #21 testnet QA and merge

Tested on 2026-11-07 by Codex against the PR head 4d0c93eb7e11dc9b481cc428996e95d7f1e19a68 in a separate worktree. GitHub Actions run 42367737200 passed web, contracts, and escrow-wasm. The downloaded artifact was built from that commit; its SHA-256 is 8107a7f92098e79aa1522a853adec0a950977ba4a463bfd8c2e8c5bd6508c387. Its NEAR code hash is 9ggN7z1oTekunzEceJGv6ufRwaW6smrfiUGNSt2HeRRG, matching the deployed code on escrow-tp5.tp5-codex-qa-20261107-a.testnet.

The disposable deployment used usdc.tidepool-sandbox.testnet, verifier.tidepool-sandbox.testnet, and a fresh test relayer. Test accounts were tp5-codex-qa-20261107-a.testnet, host-b.tp5-codex-qa-20261107-b.testnet, guest-1.tp5-codex-qa-20261107-b.testnet, guest-2.tp5-codex-qa-20261107-b.testnet, guest-3.tp5-codex-qa-20261107-b.testnet, guest-4.tp5-codex-qa-20261107-b.testnet, stranger.tp5-codex-qa-20261107-b.testnet, and relayer.tp5-codex-qa-20261107-b.testnet. No credentials are recorded here.

PR #21 was merged on 2026-11-08 as `e8329a603600bd08bc57733d0b24e5cffe25b2df`. Its final head `267f6d60b3434bc4df0e4b4ebc7ff70f5dc1abe8` passed GitHub Actions run [42441930530](https://github.com/AstralEX1/Nearvent/actions/runs/42441930530): web tests and production build, contracts including both sandbox scenarios, and reproducible escrow WASM. The original main worktree also held eight later StageShow/demo changes; they were committed and pushed in `0e25579`. GitHub Actions run [42443470979](https://github.com/AstralEX1/Nearvent/actions/runs/42443470979) then passed web (tests and production build), contracts/sandbox, and reproducible escrow WASM on that follow-up main commit. No deployment or app-default switch was part of the merge.

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

## TP6 testnet deploy (2026-11-10, Claude)

Source: main `2c2f010deb9d23190b63dd1fa0ac326e283269bd` (PR #25). CI run
42759603371 artifact `escrow-wasm-2c2f010…`: `near_events.wasm`, 240,871 bytes,
SHA-256 `e0ea8c89dd2ccee1c90bad257757d3dc1e70d4e78789e8ddc452005bfc518ba9`,
NEAR code hash `G8ym7g1tSQevzz9qXHynUvRyDHnxG3iBz8zxhdZ8ZUo2`.
`deploy-escrow.mjs` created `escrow-tp6.tp6-nv1110.testnet` (9.5 NEAR) under the
faucet account `tp6-nv1110.testnet`, deployed and initialised it in one
transaction (usdc `usdc.tidepool-sandbox.testnet`, intents
`verifier.tidepool-sandbox.testnet`, relayer `relayer-nearevents-11022103.testnet`;
the Vercel project has no `RELAYER_ACCOUNT_ID`, so the local relayer was used),
and registered its Tidepool USDC storage. `verify-escrow-code.mjs` matched the
on-chain hash.

Smoke on faucet accounts `tp6host-nv1110`, `tp6guest1-nv1110`, `tp6guest2-nv1110`
(all passed):
- Free event, 50 seats, 0.5 NEAR attached → created, NEAR returned:
  `5dmDnqiFX2PguET8SkoTbHFPYSGPTpMtUPjSct6k59sj`.
- 51 seats without NEAR → rejected ("beyond the free tier"); with
  `create_event_cost` (0.33764 NEAR) + 1 NEAR → created, 1 NEAR returned:
  `26afNHd8Cg5GVLQXcqhGrWNCojLfrkGTrnGEtkgSKn3D`; later cancelled
  `FngGPcyAsitk6bDiJgyZje5JFL9H1BzV5xn9xuPRY4zU`.
- Deposit flow (event 0): two 0.1 USDC registrations
  `DB9MtjrsfZXB923dZTpTY6D68wW8oH1ZjWdovfmtszen`,
  `3YksvG3unQFM6vmxr72d1cWZyUjC9x9rXv7Z8Gb47En9`; finalize with guest1
  `7SwvaMPX9h7s5whMss8UKNdGaB4BtWbeaHK7rYR58YtH`; `get_attended_count` = 1,
  balance 0.2 USDC; withdraw `6gEZvogYJ35xWAUCXwbDQUzDbxmxsj8JmTAEMWCTHxo7`.
- Ticket (event 2): create `2K6curURmb8WaGsJxAkkH6c9RPPxkbamLL6Jv1JEf262`, buy
  `2RHXieQbfLjJyRAQvdiyXHgUMLjymgoe6reh4BvCJQkZ` → host escrow balance 0.1 USDC
  while the event was still open; finalize
  `EW7x933YHtZC6bPMtd2eqq7DAhqjoKY7RtD63wYtNT3f` (guest2 attended count 1); host
  withdraw `4Zv5RYZ4agLvudCqL9CNgGe2ARkZiRZYgkwmdRmPcmBW`.

Not covered: 1Click/Intents registration, relayer `payout_to_intents`, the
3rd-open-event charge, UI wallet signing.

## Audit fixes on tp7 (2026-11-10, Claude)

An outside audit found: H-01, the host could `finalize` at any time, even before
the start, and pay the pool to its own extra account; H-02, the free tier
counted only open events, so create → cancel loops (free for EVM hosts through
our relayer) left event records on our storage pool forever; M-01, registration
stayed open after the end. Fixes, upgraded in place on
`escrow-tp7.tp7-nv1110.testnet` (state migrated, the demo `/e/4` kept its six
guests):
- `finalize` only once `ends_at` has passed; `cancel` (full refund) any time.
- Registration closes at `ends_at`; a late payment comes back in full.
- The whitelist now decides who can create events at all (when its mode is on);
  the free tier has its own sponsored list and mode. Both off by default; tp7's
  old list became the host whitelist.
- Free tier: 2 free events per host in any 30 days, counted at creation, so
  closing one early gives nothing back. The open-event counter is gone; the event
  record reserve dropped to 420 B (measured 331 B).
- The app and relayer routes refuse the same calls before they cost gas; Manage
  enables "Close event" only after the end.

Checks: 138 unit tests (incl. a tp7-layout migration test), 3 sandbox scenarios
(300-guest finalize 196 Tgas), web tests (43) and production build. Upgrade tx
`DL82bpi8HLPLZ1WcSt7SiamfgLLWvRsNyqPuHuoUjsJA` with a local
`cargo near build non-reproducible-wasm` (305,732 bytes, code hash
`9bzLSqerBC3jV1BTGuivp1eqVkxua6vUAK2RTHKELEoa`; ~3.06 NEAR of code storage on
mainnet). `smoke-tp7-testnet.mjs` (now with a fresh host per run) passed all
steps: third free event in 30 days refused after a cancel, finalize before the
end refused, paid seats refunded, a paying unlisted host refused while the
whitelist was on, sponsored mode limits the free tier, the owner listed a host on
both lists through one NEP-413 `auth_call`, an EVM host's late registration was
refunded and its finalize passed after the end, an Intents duplicate came back,
a relayed payout, and an owner upgrade (`DPgkvaGVeTRnL2zVvchyXQZeqM5x6og93ey7YtdsFakC`).
The smoke also passed through the local app relayer (`APP_URL`), which refused
the early finalize with 409. Then main `96cb1ee` was pushed on Alex's command (CI
run 42817864435 green) and the owner upgraded tp7 to its reproducible WASM
(306,474 bytes, code hash `571uYapS2GwgvfAXrzAcHaLgpb1s1gScUbSb35ESWztE`, tx
`Hcz1haKBEhiaVbwPkzimWqem4JFHNS75zq1JaLPypDwK`); `verify-escrow-code.mjs` matched
and the demo `/e/4` kept its six guests.

## TP7 testnet deploy (2026-11-10, Claude)

What changed from tp6: an `owner` (set at init) can `upgrade` the code until
`freeze`, which is one-way; the escrow account keeps no access keys, so after
`freeze` the code can never change. The owner runs a host whitelist
(`set_whitelist_mode`, `add_to_whitelist`, `remove_from_whitelist`; off by
default): when on, only listed hosts get the free tier. Free events must end
within 60 days. A host who paid for storage gets the share of empty seats back
when the event closes. `on_auth` takes NEAR Intents `auth_call` intents, so EVM,
Solana and passkey wallets can create (free tier only, no NEAR attached),
finalize and cancel events; the owner can run the whitelist the same way.
Removed: `paid_by` in guest records and the never-used "pay a seat from the pool
at registration" branch with `reserved_seats`. Measured worst-case sizes: event
444 B, registration 191 B, whitelist entry 109 B; a free 50-seat event now
reserves 0.287 NEAR (was 0.331).

Checks: 130 unit tests, 3 sandbox scenarios (incl. `sandbox_upgrade_and_freeze`:
upgrade with no keys left, broken WASM leaves the old code, upgrade after
`freeze` refused), web tests (40) and production build.

Deploy: local `cargo near build non-reproducible-wasm` (285,139 bytes, NEAR code
hash `5n4RCTYYN2AUbJbsCuZbFTry8RGPuyBjfAS85GuD2WyU`); CI's reproducible build
differs, so the owner then upgraded tp7 to the CI artifact of main `19403d4`
(run 42789902597, all jobs green: 285,919 bytes, NEAR code hash
`D3VY2iUDYKtuYvWBAYQQ6UAudNCZqWQqwxV2HiXH7WAx`, upgrade tx
`BLbikMLW6SSphoew8YKUhpiWdgL4im5GdsM5ZPtVBy2r`); `verify-escrow-code.mjs` matched
and the demo event kept its six guests.
`deploy-escrow.mjs` created `escrow-tp7.tp7-nv1110.testnet` (9.5 NEAR) under the
faucet account `tp7-nv1110.testnet` (also the owner), deployed, initialised and
deleted the account's key in one transaction, then checked `get_config` and an
empty key list, and registered its Tidepool USDC storage.

`node scripts/smoke-tp7-testnet.mjs` passed on testnet (host `tp6host-nv1110`,
guest `tp6guest1-nv1110`, relayer as funder): a free event ending in 61 days is
refused; a paid 51-seat event (0.29296 NEAR) got 0.28 NEAR back for 50 empty
seats at cancel; whitelist on refuses an unlisted host and accepts a listed one;
the owner whitelisted a host through a NEP-413 `auth_call` intent; a fresh EVM
key created and finalized an event through ERC-191 `auth_call`; an Intents
registration's duplicate came back to the guest's Intents balance; a relayed
payout after cancel; owner upgrade with the same WASM
(`5ovEmf3ue62JSxkNzkY17dXWYdJM8W3pss2jDGSNydQf`) kept all events. A second
disposable escrow `escrow.tp7freeze-nv1110.testnet` was upgraded, then frozen;
the next upgrade failed with "The code is frozen".

Proof flow on tp7 event 5: pay `5THM1T3rxJ2Lm2Gnmc4YSaXUgNM87poq4hbhEZuRn6U2`,
finalize `FNzcdnkA5KNVP8C2NXCo2bgjgy73HL9yNFbsfHbn2VmB`, withdraw
`8shBJSzRK7aKDEHNPupzfvLY8funfvfR1fFbxkZEsp3Y`. Demo event `/e/4` was seeded with
`seed-demo.mjs`; the four free events (incl. the public BaliSquad `/f/GhcgconU`)
were copied in Upstash from the tp6 namespace to tp7.

Owner actions: `OWNER=… EVENTS_CONTRACT=… node scripts/escrow-owner.mjs
mode on|off | add <accounts> | remove <accounts> | upgrade <wasm> | freeze`.
For mainnet the owner should be a Ledger account; `freeze` only after the code
is final.

The smoke was run a second time with `APP_URL=http://localhost:3000`, so the
EVM host's `auth_call`s went through the app's `/api/intents/execute` route; it
passed. The site switched: Vercel Production/Preview `NEXT_PUBLIC_EVENTS_CONTRACT`
= tp7, main `19403d4` deployed, www.nearvent.site serves tp7 and `/e/4`.

Not covered: mainnet. The UI for EVM hosts came later (2026-11-11, branch
`claude/evm-host`): on tp7 a stub EVM wallet created event 32 from `/create` and
cancelled it from Manage through localhost:3000.

## Meta-transaction testnet check (2026-11-10, Claude)

`web/scripts/smoke-meta-tx.mjs` against the local app (`localhost:3000`, testnet,
`escrow-tp7`, relayer `relayer-nearevents-11022103.testnet`). A fresh implicit
account, made like a Google/email one, was activated by `/api/fastauth/fund`.
Through `/api/fastauth/relay` it created free event 12
(`HLKPc1iNMcmCZREinpEvK5hNiX41SooBhEtVaHuFYNrU`) and cancelled it
(`6ZTCtzNkFCeoFHswU7iX3M2qJHUthhzho6UHYiGf242v`); its NEAR balance did not move,
so the relayer paid the gas and the 1 yocto deposit. A forged signature (401),
another contract (400) and a create with 1 NEAR attached (400) were refused before
anything was sent. `storageFor` registered USDC storage for a fresh account
(`765b386e…57cbcc`, 0.00125 NEAR from the relayer); a second call saw it registered
and sent nothing. Earlier runs found that NEP-366 bills inner deposits to the
relayer; that is why deposits above 1 yocto are refused. Events 10 and 11 are
cancelled leftovers of those runs.

## Escrow v3 — mainnet in-place upgrade of escrow.lold.near (2026-11-13, Claude)

Release branch `claude/release-v3`: regulars, V3, the UI pass and the README; every step is a local rollback commit (list in `docs/oracle-upgrade/REPORT-v3.ru.md`). Design, for AI agents: `docs/oracle-upgrade/SPEC-v3-as-built.md`; audits and decisions in Russian: `docs/oracle-upgrade/AUDIT-v3.ru.md`.

**Done: `escrow.lold.near` upgraded in place on 2026-11-13 (signed by Alex).**
- Transaction [`22AN62wuxS1ngiEULEBbFMQw1qjziAK5BMWDgiYdndGx`](https://nearblocks.io/txns/22AN62wuxS1ngiEULEBbFMQw1qjziAK5BMWDgiYdndGx): `upgrade` + `migrate` in one receipt, 34.5 Tgas, every receipt successful.
- WASM: the CI `escrow-wasm` artifact of `a565ab9` (run 43379434997), 366 047 B, SHA-256 `e77705f825f2bd27bba04f3be947506f7d86b6ae81884de3a66dc94540de175f`, NEAR code hash `GaYShHFfXF7LDLw4QCQFP4qcDVqogvDimimREQHu2qga`.
- After it: storage 366 385 B, 5.2576 NEAR, about 1.59 NEAR spare for the free tier (about 5 open free 50-seat events at 0.31 NEAR each), no access keys, no events.
- Rules (`get_config`): `dao` null, treasury `lold.near`, `bond_per_seat` 0, `close_at_start` true, window 12 h, publish 72 h, court 168 h; `oracle_hour_ms` 3 600 000. Whitelist and sponsored modes are both off; Alex may turn the sponsored mode on next.
- `check-release.mjs` on mainnet: all green except the relayer balance (0.449 NEAR, keep at least 5).
- www runs the v3 site since `a565ab9`; `/events` and `/u/<account>` showed no console errors after the upgrade. `/docs/contract` caches the code hash for an hour (`revalidate`), so it showed the old `7nrLLgzc…` until that cache expired.
- Before it: tp7 code `7nrLLgzc…`, 0 events, 306 795 B. `migrate` turned the tp7 root into v3 with no court (`Rules::new`); it refuses a root that has events, and a panic would have rolled the whole upgrade back. Rehearsed on testnet first; see "Testnet rehearsal" below.
- Source: the contract on `main` is byte-for-byte `a565ab9`. Rebuild it with `cargo near build reproducible-wasm --manifest-path contracts/events/Cargo.toml` on that commit to compare. Never deploy a `--features short-windows` WASM: `new` and `migrate` refuse it outside `.testnet` / `.test.near`.

**Running without a court**, the default:
- the host's list is final and pays out when published, as before v3;
- there is no host bond and there are no disputes;
- Deposit registration closes at the start;
- the host publishes within 72 h after the end; after that anyone calls `refund` and every guest gets the deposit back at once.

The court, its rules and the keeper schedule ("Later, optional" below) can come any time; they apply to events created from then on.

Who does what: **Alex** signs and funds (real money). Everything else is prepared.

For a later in-place upgrade (v3 → v3 keeps running events; rehearsed on `v3rh`), the order is: CI WASM of the release commit, `OWNER=lold.near EVENTS_CONTRACT=escrow.lold.near NETWORK=mainnet node web/scripts/escrow-owner.mjs upgrade <wasm>`, then `check-release.mjs` (step 7) with `WASM=<wasm>`.

Left now:

1. **Funding (Alex).**
   - `event_relayer.near` has 0.45 NEAR; top it up to at least 5 NEAR (the only red line in `check-release.mjs` after the upgrade). It pays gas for EVM and Google relays, payouts to Intents and the refund button.
   - The escrow: optional, a plain transfer raises the free-tier pool above 1.59 NEAR.
2. **Keeper: optional without a court.** Without `CRON_SECRET`, `/api/keeper/tick` answers 503 and nothing runs on a schedule. A late list is still refunded: the event page shows a refund button (it calls `/api/keeper/event`, which the relayer pays, or the guest's own wallet). With the schedule from step 5, the keeper sends that `refund` by itself.

Later, optional: a court

3. **Court DAO (Alex signs and funds; a council of 4–5 existing NEAR accounts, 3 votes decide; Alex picked 4 on 2026-11-14):**
   - `create-court.mjs` takes the policy from `docs/oracle-upgrade/evidence/dao-init-args.example.json`, puts the accounts on the council and `event_relayer.near` in `dispute_bot` (it can only propose). The key is asked at a hidden prompt; on mainnet you type "yes" first:
     ```bash
     cd web && NETWORK=mainnet CREATOR=lold.near COUNCIL=a.near,b.near,c.near,d.near DEPOSIT=1.5 node scripts/create-court.mjs
     ```
   - Cost: on mainnet `sputnik-dao.near` uses a global contract, so the DAO stores only ~2–4 KB and the whole deposit stays as its balance (on testnet the 555 KB code costs ~5.6 NEAR). Each dispute's proposal pair stores about 0.03 NEAR, and the keeper pauses below 0.3 NEAR available, so 1.5 NEAR covers about 40 disputes; top up later.
   - When the creator is on the council the script also proposes `FactoryInfoUpdate {auto_update: false}`; otherwise a council member proposes it. 3 members approve it at [sputnik-dao.trezu.org](https://sputnik-dao.trezu.org) (open `nearvent-court.sputnik-dao.near`). Rehearsed on testnet 2026-11-14: `nearvent-court-t1114.sputnikv2.testnet`, create `8KbqsK83…`, 3 votes → Approved, `auto_update: false`.
4. **Rules (Alex signs):**
    ```bash
    OWNER=lold.near EVENTS_CONTRACT=escrow.lold.near NETWORK=mainnet node web/scripts/escrow-owner.mjs rules '{"dao":"nearvent-court.sputnik-dao.near","treasury":"<wallet>","bond_per_seat":0,"close_at_start":true,"challenge_hours":12,"submit_hours":72,"resolve_hours":168}'
    ```
    `bond_per_seat` is 0, 1 or 2 deposits per seat (Alex's default 0; a court with no bond is allowed). Only 2 deters a lying host at every size; see `docs/oracle-upgrade/REPORT-v3.ru.md` §1.
    `set_rules` refuses unsafe values:
    - a bond above 2 deposits per seat, or any bond without a court;
    - window under 12 h, publish under 24 h, court under 72 h;
    - the court as treasury, the owner or the relayer as the court, or the escrow, USDC or Intents as either.
5. **Keeper schedule (Alex: Vercel and Upstash; needed with a court, it opens the DAO proposals):**
    - `CRON_SECRET` (random, at least 32 characters) on Vercel Production.
    - An Upstash QStash schedule every 10 minutes: `POST https://www.nearvent.site/api/keeper/tick` with header `Upstash-Forward-Authorization: Bearer <CRON_SECRET>` (or Vercel Cron).
6. **Council: call an event off (`void_event`, when needed).** A council member proposes, 3 of 5 approve; every deposit and every dispute deposit go back (and the host bond, if any). Allowed after the host publishes the list and before the court deadline (`resolve_by` in `get_event`), not for an event whose host published nothing. The keeper never proposes this. With `ID` the event id:
    ```bash
    ARGS=$(printf '{"event_id":%s}' "$ID" | base64)
    near contract call-function as-transaction nearvent-court.sputnik-dao.near add_proposal json-args "{\"proposal\":{\"description\":\"Void Nearvent event $ID: <reason>\",\"kind\":{\"FunctionCall\":{\"receiver_id\":\"escrow.lold.near\",\"actions\":[{\"method_name\":\"void_event\",\"args\":\"$ARGS\",\"deposit\":\"0\",\"gas\":\"200000000000000\"}]}}}}" prepaid-gas '100 Tgas' attached-deposit '<proposal_bond from get_policy> yoctoNEAR' sign-as <member>.near network-config mainnet sign-with-keychain send
    ```
    Then three members approve it in the Sputnik UI or with `act_proposal` `{"id":<id>,"action":"VoteApprove","proposal":<kind from get_proposal>}` (300 Tgas). 200 Tgas should cover the worst case: a void is a cancel (76.5 Tgas at 300 guests) plus one pass over the disputes, lighter than a full settle (149 Tgas). Not measured; if the proposal fails for gas, nothing moves: propose again with 280 Tgas. The site then shows "Cancelled by the council".
7. **Check (read-only), after any of the steps above:**
    ```bash
    cd web && NETWORK=mainnet EVENTS_CONTRACT=escrow.lold.near RELAYER_ACCOUNT=event_relayer.near OWNER=lold.near node scripts/check-release.mjs
    ```
    Without a court "escrow v3 rules" prints "no court yet …". With one it also checks the court: council of 4–5, `auto_update` off, the vote policy (3 votes, only the council votes).

Testnet rehearsal (`evidence/v3-upgrade-rehearsal.log`):
- `v3rh.yusak-nv1109.testnet` got the mainnet code `7nrLLgzc…` from `deploy-escrow.mjs` with 5.26 NEAR (spare 2.19, as on mainnet).
- `escrow-owner.mjs upgrade` to the short-windows V3 (`22RQfNv3…`): storage 358 422 B, spare 1.67 NEAR, config kept, no court.
- `rules` set the court `nearvent-court-v3.sputnikv2.testnet`.
- Two full dispute cycles ran:
  - bond 1/seat on 9e1adc3;
  - after a v3 → v3 upgrade with live events, bond 2/seat with the 5-deposit cap on a0564b6.
  Both covered: a guest refused after the start, the host leaving a guest off, the guest's dispute, the keeper's proposals, 3 of 5 votes, the keeper's settle. Balances matched to the unit.
- Final code with the red-team fixes: a fresh `v3rh2.stan-nv1109.testnet`.
  - Mainnet code, then the upgrade `6v2bPaBh…`: spare 1.6752 NEAR.
  - The relayer as court is refused.
  - The court is set.
  - A full dispute cycle ran, and balances match.
  - The proposals carry the door log hash.
- Older v3 test escrows (`oracle-v3*.atia-nv1109.testnet`, `v3rh`) are out of the flow.
