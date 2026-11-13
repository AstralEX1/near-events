# Nearvent: show up, split the pool

[![Verify Nearvent](https://github.com/AstralEX1/near-events/actions/workflows/verify.yml/badge.svg)](https://github.com/AstralEX1/near-events/actions/workflows/verify.yml)

<a href="showcase/nearvent-showcase.mp4"><img src="showcase/preview.webp" alt="Nearvent in 30 seconds: discover an event, create one with a USDC deposit, register and get a QR pass, check guests in, close the event and withdraw the payout" width="100%"></a>

**▶ [Watch the 30-second product video with sound (MP4, 1080p)](showcase/nearvent-showcase.mp4)**

**👆 [Try the demo yourself: www.nearvent.site/demo](https://www.nearvent.site/demo)** (no wallet, made-up events and 50 demo USDC in your browser)

## For judges

- **What it is:** RSVP to a meetup with a small USDC deposit; the guests who
  come split the no-shows' deposits.
- **Try it, no wallet, 2 minutes:** [www.nearvent.site/demo](https://www.nearvent.site/demo),
  then the five steps in [Try it in two minutes](#try-it-in-two-minutes-no-wallet).
- **Live app:** [www.nearvent.site](https://www.nearvent.site) on NEAR mainnet,
  escrow [`escrow.lold.near`](https://nearblocks.io/address/escrow.lold.near)
  ([how to check its code](#networks-2026-11-12)).
- **Check without a browser:** `cargo test --locked -p near-events-sandbox`
  runs the full money cycle on a local NEAR sandbox ([Build and test](#build-and-test)).
- **Track: Real-World Money** (also Social Money). Its three hints in the code:
  stablecoins (USDC deposits and payouts, `contracts/events/src/lib.rs`), NEAR
  Intents (pay from and withdraw to other chains through 1Click,
  `web/src/app/api/oneclick/`, `web/src/app/api/intents/`), meta-transactions
  (NEP-366, our relayer pays the gas, `web/src/app/api/fastauth/relay/`).
- **Built during the hackathon:** all of it, see [Hackathon work](#hackathon-work).

**Problem.** Free meetups lose many of their RSVPs to no-shows: an RSVP costs
nothing, so hosts over-book, order the wrong amount of food and can't plan the room.

**Product.** Nearvent is a Kickback-style event app on NEAR. In Deposit mode
every guest puts down the same small USDC deposit. Guests who show up get it
back plus an equal share of the no-shows' deposits. Hosts can also sell paid
tickets or run free RSVP events. Creating an event is free.

**What is new compared to Kickback.** Kickback (2018–2023) ran on Ethereum:
deposits in ETH, every guest needed ETH for gas, and each event was a new
contract the host paid to deploy. To serve Solana or Base users, someone would
have to build the same app again for each ecosystem. Nearvent is one app for
all of them: through NEAR Intents a guest pays from the chain they already use
and takes the payout back to any chain. Deposits are in USDC, so they keep
their value; guests pay no gas; hosts create events for free; the same escrow
also sells tickets and runs free RSVPs; hosts import an existing Luma event by
its link, and a two-line button adds registration to their own website.

**Business model.** Guests never pay Nearvent a fee; hosts and venues do. For
now everything is free so we can bring hosts in. Next: a monthly plan for
communities that run regular events and a small fee on paid tickets. We will
also test sponsored placement of events in Explore. We are checking these
options with event hosts in Bali, where we run our first events.

**How NEAR fits in.**
- A Rust escrow contract on NEAR holds the deposits. The host records who came
  and the contract splits the pool among them; the host has no way to withdraw
  it directly (see [Trust model](#trust-model)).
- Payments and payouts go through NEAR Intents (`intents.near`): a guest can pay
  from another chain through 1Click and withdraw to any chain or to an Intents
  account.
- Nobody needs NEAR for gas. An EVM wallet (MetaMask etc.) registers by signing
  one intent; Google/email accounts (NEAR Auth) sign NEP-366 meta-transactions
  (on mainnet once NEAR Auth issues our client id); our relayer pays the gas in
  both cases. Hosts need no NEAR to create a small event.

## Networks (2026-11-12)

[www.nearvent.site](https://www.nearvent.site) runs on **NEAR mainnet** with real
USDC since 2026-11-11. Testnet stays for development and Vercel preview builds.

| | Mainnet (www.nearvent.site) | Testnet (development, previews) |
|---|---|---|
| Escrow | [`escrow.lold.near`](https://nearblocks.io/address/escrow.lold.near), deployed 2026-11-11 | [`escrow-tp7.tp7-nv1110.testnet`](https://testnet.nearblocks.io/address/escrow-tp7.tp7-nv1110.testnet) |
| USDC | native Circle USDC [`17208628…36133a1`](https://nearblocks.io/address/17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1) | test USDC `usdc.tidepool-sandbox.testnet` |
| NEAR Intents, 1Click | `intents.near`, `1click.chaindefuser.com` | the [Tidepool](https://www.usetidepool.tech/docs) sandbox (official verifier code), since Intents has no testnet |
| Google/email (NEAR Auth) | `fast-auth.near`; the button stays hidden until NEAR Auth issues our client id (requested 2026-11-09) | shared client, `localhost:3000` only |
| Gas for Google/email users | relayer pays (meta-transactions) | relayer gives 0.5 NEAR once |
| Demo account (made-up data in the browser) | yes | yes |
| Test USDC faucet | no | yes |

- Mainnet escrow: the CI reproducible WASM of `0361b38` (code hash
  `7nrLLgzcUP1NUyUcKACekuq1EoEXWe5jW5a314HiVjm4`), owner `lold.near`, relayer
  `event_relayer.near`. Deploy, init and key removal ran in one transaction
  ([`Br4HMem…`](https://nearblocks.io/txns/Br4HMemQfN4WhqoVDchoPQ66XeWcis7onxxJB1gXeGt6)),
  so the account has no access keys. The owner can still `upgrade` the code until
  the one-way `freeze`; `get_config` shows `frozen`, the owner and the whitelist
  and sponsored modes (both off). Evidence in [docs/DEPLOY.md](docs/DEPLOY.md#mainnet-release).
- Same code as this repo, with one catch: the mainnet WASM was built by CI in
  our private workspace repo at commit `0361b388…`. This repo has the same
  history with the AI notes filtered out, which gave every commit a new hash
  (see [Hackathon work](#hackathon-work)). cargo-near writes the commit into the
  contract's NEP-330 metadata (`contract_source_metadata`), so a rebuild here
  differs only in that embedded hash. To check, build here and swap the hash back:

  ```bash
  cd contracts && cargo near build reproducible-wasm --manifest-path events/Cargo.toml
  perl -pe "s/$(git rev-parse HEAD)/0361b388eb9ea8dbd15b29108b49837621782946/g" \
    target/near/near_events/near_events.wasm | shasum -a 256
  # 64e50a1a50efb49ab093715d3d1066f40da22855d25d89432b697f902f5d0693
  # = SHA-256 of the code on escrow.lold.near (base58: 7nrLLgzc…iVjm4)
  ```
- Testnet escrow: same rules, CI reproducible WASM of `96cb1ee` (code hash
  `571uYapS2GwgvfAXrzAcHaLgpb1s1gScUbSb35ESWztE`). Free and paid creation,
  deposit, ticket, finalize and withdraw ran there with real transactions
  before the mainnet deploy (see docs/DEPLOY.md).
- `web/scripts/check-release.mjs` checks the mainnet setup read-only: escrow code,
  keys and config, USDC, `intents.near`, the relayer, `fast-auth.near` + MPC
  signer, NEAR Auth JWT keys, 1Click tokens and a dry quote.
- Older testnet escrows (`tp3`–`tp6`) keep their test data on chain but the app does not read them.

## Try it in two minutes (no wallet)

Open **[www.nearvent.site/demo](https://www.nearvent.site/demo)** (or **Sign In** →
**Try with a demo account**). The site switches to a demo with real BaliSquad AI events,
made-up guests and 50 demo USDC. Everything stays in your browser: no server, no blockchain,
nothing to pay. **Exit Demo** in the header clears it.

1. **Explore** → *Grok Bot Workshop Bali* → type a name in **Your name** → **Register** → you appear under "Going" with a QR pass.
2. **My Events** → *Cursor Meetup - AI Agent 101* (yours, it just ended) → **Manage → Guests** → check a few guests in.
3. **Close event & pay out** → the pool is split among the guests who came.
4. *How I AI* (you went) → **Withdraw** your share.
5. **Create Event** → Stake to RSVP, Ticket or Free → it shows up in Explore.

Outside the demo the site moves real USDC on mainnet: sign in with a NEAR wallet
or an EVM browser-extension wallet (MetaMask etc.); the wallet asks before each
transaction. Free mode: on `/create` pick Free → `/f/<id>` with a one-click RSVP. User docs: [www.nearvent.site/docs](https://www.nearvent.site/docs),
smart contract: [/docs/contract](https://www.nearvent.site/docs/contract).

## Run it locally

```bash
cd web
cp .env.example .env.local      # optional server settings are listed in docs/DEPLOY.md
npm install
npm run dev                     # http://localhost:3000
```

`.env.example` already points at the testnet escrow; `.env.mainnet.example`
lists the mainnet settings. Set `APP_SECRET` to any
long random string (it signs host and door-team sessions). Without Upstash
settings the server keeps check-ins, names and event details in `web/.data/`. The test
USDC top-up and EVM registration need a relayer account (`RELAYER_ACCOUNT_ID`,
`RELAYER_PRIVATE_KEY`, see docs/DEPLOY.md); without it, get test USDC from
Tidepool. Google/email sign-in works on `http://localhost:3000` once
`NEXT_PUBLIC_FASTAUTH_CLIENT_ID` is set to the shared testnet client from
docs.auth.near.org. Then follow the steps above on `localhost:3000`.

Without a browser or any account, `cargo test --locked -p near-events-sandbox`
(see [Build and test](#build-and-test)) runs the whole money cycle on a local
NEAR sandbox: deposit event with no-shows, ticket event, upgrade and freeze.

## Rules the escrow enforces

- Free tier for hosts: the escrow pays storage for events up to 50 seats that
  end within 60 days, up to 2 free events per host in any 30 days (closing one
  early does not give it back). Bigger or extra events cost the host a little
  NEAR for storage (~0.29 NEAR for 50 seats, ~1.7 NEAR for 300), and the empty
  seats' share comes back at close.
- The host decides who came, so with the whitelist mode on only whitelisted
  (verified) hosts can create events at all. A separate sponsored list, when its
  mode is on, limits the free tier to listed hosts. Both are off by default.
- The host can `finalize` only after the event ends; before that the only way
  out is `cancel`, which refunds everyone. Registration closes at the end.
- Deposit mode: the host records who showed up but cannot take the pool. Ticket
  mode: each ticket goes to the host's balance at registration and is never
  refunded.
- The host can cancel a Deposit event and refund everyone at any time; anyone
  can do it 30 days after the event ended if the host never closed it.
- A guest always pays for their own seat; only a payment relayed by NEAR
  Intents names the guest.
- Each guest's profile shows how many closed events they attended (an on-chain
  counter, `get_attended_count`).
- The host is any NEAR account. The door team (co-hosts), check-ins, guest
  names, profiles, location, description and cover live on the Nearvent server,
  not in the escrow; only the host can close or cancel.

## Trust model

- **The host decides who came.** `finalize` counts only accounts registered for
  that event, but a host who registers extra accounts of their own and marks
  only those as present takes the real guests' deposits. For now this rests on
  trusted hosts, as with any meetup: guests already trust the organiser with
  the venue and the list. Profiles show how many events a person hosted, how
  many guests came and how many events they attended, and with the whitelist
  mode on (off now) only hosts the owner verified can create events. If hosts
  ever need to be trustless, the next step is an attendance oracle (for example
  check-ins signed by guests' own wallets at the door) so the host no longer
  writes the list alone.
- **The host cannot withdraw the pool.** The escrow credits USDC only as shares
  to attended guests, refunds, the rounding remainder (to the host) and, in
  Ticket mode, the ticket price to the host at registration. Each account can
  withdraw only its own balance.
- **Check-ins live on the Nearvent server**; the host signs `finalize` with that
  list. Without our server the host can still `finalize` or `cancel` from any
  NEAR client, and anyone can `cancel` 30 days after the end, refunding every
  deposit.
- **The owner (`lold.near` on mainnet)** has no method that moves balances, but
  until `freeze` it can replace the code, so until then guests trust the owner
  too.

## Current limits

- **Google/email sign-in on mainnet** is built and was tested on testnet. It
  appears on www.nearvent.site once NEAR Auth approves our application
  (submitted 2026-11-09).
- **The escrow is not frozen yet.** We plan upgrades, so the owner keeps the
  right to replace the code; `freeze` makes it immutable and cannot be undone.

## Embed on your website

Add a registration button to an existing event page with two lines:

```html
<script src="https://YOUR-NEARVENT-HOST/embed.js" async></script>
<near-event event="YOUR_EVENT_ID" mode="button"></near-event>
```

The button opens Nearvent checkout in a separate window when the browser allows
it; on phones it may open a new tab, and blocked pop-ups fall back to the
current tab. After registering, the button stays available to reopen the guest's
QR pass or, after the event closes, their payout or refund page; guests may need
to sign in again. Create or import an event at `/create`, then copy its button
code and direct `/p/{id}` checkout link from the creation screen or Manage →
Registration. Existing event-card and iframe embeds remain supported. Details:
[docs/EMBED.md](docs/EMBED.md).

## How it works

```
guest ──(any chain via 1Click | USDC from a NEAR wallet | Google login)──► NEAR Intents
                                                                              │
host ──────────── create_event / finalize(attended) ──► escrow contract (NEAR)
                                                                              │
                   pool / attendees → internal balances → withdraw through Intents
                                   (any chain via 1Click, or any Intents account)
```

Contract: `contracts/events/src/lib.rs` (unit tests in `tests.rs`).

**EVM wallet flow:** the guest signs an ERC-191 intent
`ft_withdraw {token: USDC, receiver_id: escrow, msg: register}`; `/api/intents/execute`
checks it is only a Nearvent registration and submits it to `intents.near`
(`execute_intents`), which calls `ft_transfer_call` on the escrow.

**Google/email flow on mainnet:** NEAR Auth gives the guest an implicit NEAR
account whose key sits in the MPC network. The relayer creates the account with
0.003 NEAR (its storage only). Each action is a NEP-366 delegate action the guest
approves in the Auth0 popup; `/api/fastauth/sign` asks `fast-auth.near` to sign it
and `/api/fastauth/relay` sends it, paying the gas. Both routes relay only calls to
the escrow, USDC, and USDC leaving NEAR Intents.

| Method | Who | What |
|---|---|---|
| `create_event(metadata, deposit, capacity, mode)` | anyone (caller = host) | `metadata` = `{title, starts_at, ends_at}`. Payable. Whitelist mode on: listed hosts only. Free tier (≤ 50 seats, 2 per host in 30 days, ending within 60 days, sponsored hosts when that mode is on): the contract pays storage, attached NEAR is returned. Otherwise attach ≥ `create_event_cost`, the excess is returned. Capacity ≤ 300 (finalize gas), deposit ≥ 0.1 USDC. Title and times cannot be changed later |
| `ft_transfer_call` → `ft_on_transfer` | guest / verifier | `{"action":"register","event_id":N}`; `guest` only from the Intents verifier (from anyone else it must equal the sender, otherwise the whole amount is returned) |
| `finalize(event_id, attended)` | host (+1 yocto), after `ends_at` | `attended` = guests checked in at the door (kept off-chain on our server until now). Deposit: pool ÷ attendees, remainder to host, empty list → full refund. Ticket: only closes; the host was paid at registration |
| `cancel(event_id)` | host any time while open; anyone after event end + 30 days (+1 yocto) | refund every deposit (Ticket: refunds nothing) |
| `withdraw(amount, receiver_id, to_intents)` | guest (+1 yocto) | to a NEAR account (e.g. a 1Click deposit address) or into NEAR Intents |
| `payout_to_intents(account_id)` | owner or configured relayer | moves that account's balance into *its own* Intents balance; how EVM-wallet guests get paid |
| `on_auth` | NEAR Intents wallets via an `auth_call` intent | create (free tier), finalize or cancel an event as an EVM/Solana/passkey host |
| `upgrade`, `freeze` | owner (+1 yocto) | new code until the one-way `freeze` |
| `set_whitelist_mode`, `add_to_whitelist`, `remove_from_whitelist` | owner (+1 yocto) | when on, only listed hosts create events (off by default) |
| `set_sponsored_mode`, `add_sponsored`, `remove_sponsored` | owner (+1 yocto) | when on, only listed hosts get the free tier (off by default) |

Views: `get_event`, `get_recent_events(limit ≤ 100)`, `get_guests`,
`get_guest_status`, `get_guest_statuses(account_id, event_ids ≤ 100)`, `balance_of`,
`create_event_cost(host, capacity, ends_at)` (yoctoNEAR, 0 when free), `get_attended_count(account_id)`, `get_config`.
There is no pause, event editing or single-guest refund, and no method lets the owner touch balances (until `freeze` the owner can replace the code). The door team,
location, description and cover live on the Nearvent server, not in the escrow.

Init is private and runs atomically with deploy. Set `relayer` at initialization
for an escrow accepting EVM guests. Privileged mutators require exactly 1 yoctoNEAR.

Pay from another chain by funding your own NEAR Intents balance through 1Click,
then confirm registration. A declined registration returns the unused amount to
the payment sender through NEP-141. The Intents verifier can recredit the original
withdrawal owner. **Never use plain `ft_transfer` to send USDC to the escrow.**
It creates neither a registration nor a recoverable credit.

The escrow reserves storage for open seats and future refunds. The deploy
instructions explain how to move to this storage layout.

## Build and test

Needs Node 22 (`web/.nvmrc`), Rust 1.97.1 and cargo-near 0.22.0, the same as CI
(`.github/workflows/verify.yml`); the reproducible build also needs Docker.

```bash
cd contracts
cargo test --locked -p near-events -p test-usdc   # unit tests
cargo test --locked -p near-events-sandbox        # full cycles on a local sandbox
cargo near build non-reproducible-wasm --locked --manifest-path events/Cargo.toml
cd ../web
npm ci && npm test && npm run build               # web tests and production build
```

Use the `cargo near build` command for local development. For a release, build the committed
snapshot using `cargo near build reproducible-wasm --manifest-path events/Cargo.toml`
and verify its hash against the deployed account. See [deployment and release checks](docs/DEPLOY.md).

## Built with

Rust `near-sdk` 5.29.1 and `near-contract-standards`, `cargo-near`; Next.js 16,
React 19, Tailwind CSS 4; `near-api-js` 7 (and 5 for FastAuth);
`@hot-labs/near-connect` (wallets); `@fast-auth-near/*` (FastAuth, Google/email
sign-in); NEAR Intents and the 1Click API; Upstash Redis and Vercel for the
off-chain parts. UI: SL UI Library components (MIT, vendored in
`web/src/components/sl-ui/`), the Geist font. Photos and brand marks are credited
in `web/public/event-themes/ATTRIBUTION.md` and `web/public/landing/MEDIA.md`.

**AI disclosure:** the contract, web app, scripts and documentation were
AI-assisted with Claude, Cursor and Codex, directed and reviewed by the author.

## Hackathon work

All code here was written during NEAR HACKATHON (window opened 2026-10-19; the
first commit is from 2026-11-02). No pre-hackathon code or own older libraries
are included. The empty baseline is tagged `pre-hackathon` and the submitted
state `hackathon-submission`; the full diff is
[`pre-hackathon...hackathon-submission`](https://github.com/AstralEX1/near-events/compare/pre-hackathon...hackathon-submission).

The history here is the product's real commit history from our private
workspace repo. The workspace's AI notes, planning, research and agent skills
were filtered out of every commit with `git filter-branch`; dates, messages and
authors are unchanged, and `pre-hackathon` is an empty baseline commit under
them. Working names during the hackathon were Near Events and Near Me; they
remain in some code strings, account names and the deployed contract's messages.

## License

MIT, see [LICENSE](LICENSE).

