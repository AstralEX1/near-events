# Nearvent: show up, split the pool

**Problem.** Free meetups lose many of their RSVPs to no-shows: an RSVP costs
nothing, so hosts over-book, order the wrong amount of food and can't plan the room.

**Product.** Nearvent is a Kickback-style event app on NEAR. In Deposit mode
every guest puts down the same small USDC deposit. Guests who show up get it
back plus an equal share of the no-shows' deposits. Hosts can also sell paid
tickets or run free RSVP events. No platform fee, and creating an event is free.

**How NEAR fits in.**
- A Rust escrow contract on NEAR holds the deposits. The host records who came
  but cannot take the pool; the contract splits it.
- Payments and payouts go through NEAR Intents (`intents.near`): a guest can pay
  from another chain through 1Click and withdraw to any chain or to an Intents
  account.
- Nobody needs NEAR for gas. An EVM wallet (MetaMask etc.) registers by signing
  one intent; Google/email accounts (NEAR Auth) sign NEP-366 meta-transactions;
  our relayer pays the gas in both cases. Hosts need no NEAR to create a small event.

Hackathon track: Real-World Money (USDC deposits, NEAR Intents, gasless onboarding).

## Networks (2026-11-10)

Nearvent is released on **NEAR mainnet** with real USDC. Testnet stays for the
demo and for development.

| | Mainnet (release) | Testnet (demo, development) |
|---|---|---|
| Escrow | deploy pending: steps and checks in [docs/DEPLOY.md](docs/DEPLOY.md#mainnet-release) | [`escrow-tp7.tp7-nv1110.testnet`](https://testnet.nearblocks.io/address/escrow-tp7.tp7-nv1110.testnet) |
| USDC | native Circle USDC [`17208628…36133a1`](https://nearblocks.io/address/17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1) | test USDC `usdc.tidepool-sandbox.testnet` |
| NEAR Intents, 1Click | `intents.near`, `1click.chaindefuser.com` | the [Tidepool](https://www.usetidepool.tech/docs) sandbox (official verifier code), since Intents has no testnet |
| Google/email (NEAR Auth) | `fast-auth.near`; needs our own Auth0 client (application sent 2026-11-09) | shared client, `localhost:3000` only |
| Gas for Google/email users | relayer pays (meta-transactions) | relayer gives 0.5 NEAR once |
| Demo account, test USDC faucet | no | yes |

- Hosted site: [www.nearvent.site](https://www.nearvent.site) (Vercel + Upstash
  Redis), still on testnet until the mainnet escrow is deployed; demo event:
  [www.nearvent.site/e/4](https://www.nearvent.site/e/4).
- The testnet escrow runs a local build with the 2026-11-10 audit fixes (code
  hash `9bzLSqerBC3jV1BTGuivp1eqVkxua6vUAK2RTHKELEoa`; the CI reproducible WASM
  replaces it once these commits are pushed). The account has no keys; the
  owner can upgrade the code until `freeze` (`get_config` shows the owner and
  whether it is frozen). Evidence in [docs/DEPLOY.md](docs/DEPLOY.md).
- Mainnet pieces checked read-only on 2026-11-10 with `web/scripts/check-release.mjs`:
  protocol 88, USDC, `intents.near`, `fast-auth.near` + MPC signer, NEAR Auth
  JWT keys, 1Click token list and a dry quote. No mainnet transaction was sent.
- Older testnet escrows (`tp3`–`tp6`) keep their test data on chain but the app does not read them.

## Try it in two minutes (testnet, no wallet)

Open **[www.nearvent.site](https://www.nearvent.site)** → **Sign In** → **Try with a
demo account**. You get a fresh NEAR account with a little NEAR for gas and
2 test USDC. Every action signs on its own (no wallet, no popups), and each one
is a real NEAR transaction you can open in the explorer.

1. **Create Event** → **Stake to RSVP** → 0.1 USDC → **Create Event** → the event is on-chain.
2. Open the event link in a private window, take another demo account, press
   **Register** → you appear under "Going" with a QR pass.
3. Back as the host: **Manage → Guests → Check in** → saved on our server, no
   transaction per guest.
4. **Close event & pay out** → one transaction sends the list of who came; the
   escrow splits the pool.
5. As the guest, press **Withdraw** → the deposit plus the no-shows' share
   leaves the escrow.

A NEAR testnet wallet or MetaMask works the same way, with the wallet asking
before each transaction. Free mode: on `/create` pick Free → `/f/<id>` with a
one-click RSVP. User docs: [www.nearvent.site/docs](https://www.nearvent.site/docs),
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

Without a browser, the contract cycle runs from scripts (they use your own
testnet accounts from `~/.near-credentials`):

```bash
cd web
export EVENTS_CONTRACT=escrow-tp7.tp7-nv1110.testnet HOST_ACCOUNT=<you>.testnet GUEST_ACCOUNT=<friend>.testnet
node scripts/smoke-intents-testnet.mjs   # deposit via 1Click → finalize(attended) → cash out to Base and into Intents
node scripts/smoke-tickets-testnet.mjs   # paid ticket → host paid at registration → finalize → cancel refunds nothing
```

These scripts last passed on 2026-11-05 against an older escrow. The current
escrow was checked with direct transactions on 2026-11-10 (free tier, paid
creation, deposit, ticket, finalize, withdraw; see docs/DEPLOY.md).

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
There is no pause, event editing or single-guest refund, and the owner cannot touch balances. The door team,
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

```bash
cd contracts
cargo test --locked -p near-events -p test-usdc
cargo test --locked -p near-events-sandbox
cargo near build non-reproducible-wasm --locked --manifest-path events/Cargo.toml
```

Use the last command for local development. For a release, build the committed
snapshot using `cargo near build reproducible-wasm --manifest-path events/Cargo.toml`
and verify its hash against the deployed account. See [deployment and release checks](docs/DEPLOY.md).

## Built with

Rust `near-sdk` 5.29.1 and `near-contract-standards`, `cargo-near`; Next.js 16,
React 19, Tailwind CSS 4; `near-api-js` 7 (and 5 for FastAuth);
`@hot-labs/near-connect` (wallets); `@fast-auth-near/*` (FastAuth, Google/email
sign-in); NEAR Intents and the 1Click API.

**AI disclosure:** the contract, web app, scripts and documentation were
AI-assisted with Claude, Cursor and Codex, directed and reviewed by the author.

## Hackathon work

All code here was written during NEAR HACKATHON (window opened 2026-10-19; the
first commit is from 2026-11-02). No pre-hackathon code or own older libraries
are included. The empty baseline is tagged `pre-hackathon` and the submitted
state `hackathon-submission`; the full diff is
[`pre-hackathon...hackathon-submission`](https://github.com/AstralEX1/near-events/compare/pre-hackathon...hackathon-submission).

## License

MIT, see [LICENSE](LICENSE).

