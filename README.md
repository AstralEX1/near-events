# Nearvent: show up, split the pool

[![Verify Nearvent](https://github.com/AstralEX1/near-events/actions/workflows/verify.yml/badge.svg)](https://github.com/AstralEX1/near-events/actions/workflows/verify.yml)

<a href="showcase/nearvent-showcase.mp4"><img src="showcase/preview.webp" alt="Nearvent in 30 seconds: discover an event, create one with a USDC deposit, register and get a QR pass, check guests in, close the event and withdraw the payout" width="100%"></a>

**▶ [Watch the 30-second product video with sound (MP4, 1080p)](showcase/nearvent-showcase.mp4)**

**👆 [Try the demo yourself: www.nearvent.site/demo](https://www.nearvent.site/demo)** (no wallet, real BaliSquad AI events with made-up guests and 50 demo USDC in your browser)

## For judges

- **Track: Social Money.** Reputation-based access, a Sputnik DAO as the
  event host and as the dispute council (votes in Trezu), named accounts as
  identity; see [Social Money](#social-money-dao-reputation-named-accounts).
  Already got our first client, BaliSquad (90% of Bali's meetup market):
  [our first event with them](https://balisquad.com/event/bukitsocial-z3CmSN),
  [our landing](https://www.nearvent.site/about).
- **Track: Real-World Money.** Its three hints in the code: stablecoins (USDC
  deposits and payouts, `contracts/events/src/lib.rs`), NEAR Intents (pay from
  and withdraw to other chains through 1Click, `web/src/app/api/oneclick/`,
  `web/src/app/api/intents/`), meta-transactions (NEP-366, our relayer pays the
  gas, `web/src/app/api/fastauth/relay/`).
- **What it is:** RSVP to a meetup with a small USDC deposit; the guests who
  come split the no-shows' deposits.
- **Try it, no wallet, 2 minutes:** [www.nearvent.site/demo](https://www.nearvent.site/demo);
  the steps are in the [user docs](https://www.nearvent.site/docs).
- **Live app:** [www.nearvent.site](https://www.nearvent.site) on NEAR mainnet,
  escrow [`escrow.lold.near`](https://nearblocks.io/address/escrow.lold.near).
- **Check without a browser:** `cargo test --locked -p near-events-sandbox`
  runs the full money cycle on a local NEAR sandbox ([Build and test](#build-and-test)).
- **Built during the hackathon:** all of it, see [Hackathon work](#hackathon-work).

**Problem.** Free meetups lose many of their RSVPs to no-shows: an RSVP costs
nothing, so hosts over-book, order the wrong amount of food and can't plan the room.

**Product.** Nearvent is a Kickback-style event app on NEAR. In Deposit mode
every guest puts down the same small USDC deposit. Guests who show up get it
back plus an equal share of the no-shows' deposits. Hosts can also sell paid
tickets or run free RSVP events. Creating an event is free.

**Business model.** Guests never pay Nearvent a fee; hosts and venues do. For
now everything is free so we can bring hosts in. Next: a monthly plan for
communities that run regular events and a small fee on paid tickets. We will
also test sponsored placement of events in Explore. We are checking these
options with event hosts in Bali, where we run our first events. We keep
hosting and attending meetups there, showing Nearvent to hosts and introducing
the local crypto crowd to NEAR Intents.

**How NEAR fits in.**
- A Rust escrow contract on NEAR holds the deposits. The host records who came
  and the contract splits the pool among them; the host has no way to withdraw
  it directly (see [Optimistic escrow](#optimistic-escrow)).
- Payments and payouts go through NEAR Intents (`intents.near`): a guest can pay
  from another chain through 1Click and withdraw to any chain or to an Intents
  account.
- Nobody needs NEAR for gas. An EVM wallet (MetaMask etc.) registers by signing
  one intent; Google/email accounts (NEAR Auth) sign NEP-366 meta-transactions
  (on mainnet once NEAR Auth issues our client id); our relayer pays the gas in
  both cases. Hosts need no NEAR to create a small event.
- A community can run its events as a Sputnik DAO, and the escrow can admit
  only the regulars of a host; see [Social Money](#social-money-dao-reputation-named-accounts).

## Already got our first client: BaliSquad

BaliSquad runs most of the meetups in Bali (90% market share). Together with
its founder we ran our first event on Nearvent: the AI Coworking Meetup in
Uluwatu on 9 November ([the event on BaliSquad](https://balisquad.com/event/bukitsocial-z3CmSN)).
7 guests put down a deposit and all 7 checked in. That first run used NEAR
testnet and test USDC. The founder liked it: he sees the same problem at his
own events, where free RSVPs often don't show up. Photos and clips from the
evening are on [our landing](https://www.nearvent.site/about).

## Social Money: DAO, reputation, named accounts

**Reputation-based access ("Regulars").** A host can open an event only to
guests who came to at least N of the host's last events (up to 10), optionally
with at most M no-shows, and open it to everyone from a chosen time ("regulars
first, then everyone"). The escrow checks the rule at every registration,
including payments relayed by NEAR Intents (`AccessRule`, `check_access` in
`contracts/events/src/lib.rs`), so going around the website does not help. The
record is the escrow's own: who was checked in at the host's closed events.

**Reputation on profiles.** Next to a name: ✓ Attended (closed events where the
person was checked in) and ⚑ Held (events the person hosted and closed, and how
many guests came). Events a host abandoned do not count. Everything comes from
public escrow records (`web/src/lib/reputationShared.ts`, `/api/reputation`)
and shows on `/u/<account>`, `/profile` and in Manage → Guests ("First event"
for newcomers).

**A community DAO as the host.** Any `*.sputnik-dao.near` account can host
events:
- The DAO creates an event with a FunctionCall proposal to `create_event`.
  The free tier covers small events; a bigger one is paid from the DAO's own
  balance, the community's shared budget.
- On the site, the members of the DAO's `council` role act as the host: Manage,
  door team and check-in (`web/src/lib/daoHost.ts`).
- Publishing who came and cancelling become DAO proposals that Manage builds
  (`add_proposal`). The call runs when the council approves it in any Sputnik
  UI, such as [Trezu](https://sputnik-dao.trezu.org).
- The deposits never go to the DAO: they stay in the escrow and go to the
  guests who came.

**Programmable rewards.** The contract itself moves the no-shows' deposits to
the guests who came; nobody holds the pool in between.

**Named accounts.** Every host, guest, door-team member and council member is
a NEAR account. Named accounts (for example `alice.near` or
`builders.sputnik-dao.near`) are the identity across the app:
- profile URLs (`/u/<account>`), reputation, access rules and the door team are
  keyed by the account name;
- the site recognises a DAO host by its `.sputnik-dao.near` name;
- our own accounts are named too (`escrow.lold.near`, `event_relayer.near`).

Google/email users get an implicit account and EVM users their `0x` NEAR
Intents account; the site shortens both on screen.

## Optimistic escrow

The escrow holds the deposits; the host only says who came.

- **The host cannot take the pool.** USDC leaves the escrow only as shares to
  the guests who came, refunds and, for tickets, the ticket price to the host
  at registration. Each account withdraws only its own balance. No method lets
  the owner (`lold.near`) touch balances, though it can replace the code until
  the one-way `freeze`.
- **Optimistic by default.** We count on hosts being honest, as at any meetup,
  so the host's list is final and pays out at once, as in Kickback. Hosts'
  records are public, and with the whitelist mode on (off now) only verified
  hosts can create events.
- **Optional dispute oracle.** For communities that want a check, the owner
  turns on a Sputnik DAO court (`set_rules`). After the host publishes who
  came, guests have 12 hours to dispute one record by locking one deposit. Our
  keeper bot opens a proposal; when 3 of the 5 council members approve, it calls
  `resolve_dispute`. Then anyone calls `settle`. If a published list is broken
  as a whole, the council can instead call the event off (`void_event`):
  everyone gets their deposit back. Nobody votes unless someone disputes, and a
  host bond can be required too (0 by default). We expect most events never to
  need it.
- **Deadlines.** Registration for deposit events closes at the start. The host
  publishes who came within 72 hours after the end; if not, anyone can call
  `refund`, and everyone gets the deposit back unless guests prove they came.
  The host can cancel and refund everyone while the event is open.
- **Limits.** Free for hosts up to 50 seats, 2 events per 30 days, ending
  within 60 days; bigger events pay a little NEAR for storage. Up to 300 seats,
  deposit from 0.1 USDC.
- **Off-chain parts.** Check-ins, the door team, guest names and event details
  live on the Nearvent server. The door log only grows and is frozen once the
  list is published. Without our server the host can still publish or cancel
  from any NEAR client.

The full rules are in the comments at the top of `contracts/events/src/lib.rs`.

## Networks

- **Mainnet**, www.nearvent.site since 2026-11-11: escrow
  [`escrow.lold.near`](https://nearblocks.io/address/escrow.lold.near), owner
  `lold.near`, relayer `event_relayer.near`, no access keys on the escrow.
  Native Circle USDC, `intents.near` and 1Click. Releases use the CI
  reproducible build; hashes and checks are in [docs/DEPLOY.md](docs/DEPLOY.md#mainnet-release),
  and `web/scripts/check-release.mjs` checks the setup read-only.
- **Testnet** is for development and preview builds. We ran one real event on
  it, the BaliSquad meetup above.

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
| `create_event(metadata, deposit, capacity, mode, access?)` | anyone (caller = host) | `metadata` = `{title, starts_at, ends_at}`; `access` = optional Regulars rule. Payable. Whitelist mode on: listed hosts only. Free tier (≤ 50 seats, 2 per host in 30 days, ending within 60 days, sponsored hosts when that mode is on): the contract pays storage, attached NEAR is returned. Otherwise attach ≥ `create_event_cost`, the excess is returned. Capacity ≤ 300 (finalize gas), deposit ≥ 0.1 USDC. Title and times cannot be changed later |
| `ft_transfer_call` → `ft_on_transfer` | guest / verifier | `{"action":"register","event_id":N}`; `guest` only from the Intents verifier (from anyone else it must equal the sender, otherwise the whole amount is returned). With the oracle on, also `host_bond` and `dispute` |
| `finalize(event_id, attended)` | host (+1 yocto), after `ends_at`, within 72 h | `attended` = guests checked in at the door. Deposit without the oracle: pool ÷ attendees at once, remainder to host, empty list → full refund; with the oracle it opens the 12-hour dispute window. Ticket: only closes; the host was paid at registration |
| `refund(event_id)` | anyone, when no list came within 72 h | publishes an empty list in the host's place; guests who came can still prove it |
| `settle(event_id)` | anyone | oracle on: pays out once the dispute window is over and the council has decided |
| `resolve_dispute(event_id, target, upheld)` | the event's court DAO, through an approved proposal | decides one dispute |
| `void_event(event_id)` | the event's court DAO, through an approved proposal, after the list is published | calls the event off: every deposit, dispute deposit and host bond goes back; nothing to the treasury |
| `cancel(event_id)` | Deposit: the host while open (once a bond is locked, only before the start). Ticket: the host while open, anyone 30 days after the end (+1 yocto) | refund every deposit and bond (Ticket: refunds nothing) |
| `withdraw(amount, receiver_id, to_intents)` | guest (+1 yocto) | to a NEAR account (e.g. a 1Click deposit address) or into NEAR Intents |
| `payout_to_intents(account_id, amount?)` | owner or configured relayer | moves that account's balance into *its own* Intents balance; how EVM-wallet guests get paid |
| `on_auth` | NEAR Intents wallets via an `auth_call` intent | create (free tier), finalize or cancel an event as an EVM/Solana/passkey host |
| `set_rules(rules)` | owner (+1 yocto) | oracle settings for events created from now on: court DAO, treasury, bond per seat, hours |
| `upgrade`, `freeze` | owner (+1 yocto) | new code until the one-way `freeze` |
| `set_whitelist_mode`, `add_to_whitelist`, `remove_from_whitelist` | owner (+1 yocto) | when on, only listed hosts create events (off by default) |
| `set_sponsored_mode`, `add_sponsored`, `remove_sponsored` | owner (+1 yocto) | when on, only listed hosts get the free tier (off by default) |

Views: `get_event`, `get_events(from_index, limit ≤ 100)`, `get_recent_events(limit ≤ 100)`,
`get_guests`, `get_disputes`, `get_guest_status`, `get_guest_statuses(account_id, event_ids ≤ 100)`,
`balance_of`, `check_access(event_id, account_id)`,
`create_event_cost(host, capacity, ends_at)` (yoctoNEAR, 0 when free), `can_create`,
`is_whitelisted`, `is_sponsored`, `get_config`.
There is no pause, event editing or single-guest refund, and no method lets the owner touch balances (until `freeze` the owner can replace the code). The door team,
location, description and cover live on the Nearvent server, not in the escrow.

Init is private and runs atomically with deploy. Set `relayer` at initialization
for an escrow accepting EVM guests. Privileged mutators require exactly 1 yoctoNEAR.

Pay from another chain by funding your own NEAR Intents balance through 1Click,
then confirm registration. A declined registration returns the unused amount to
the payment sender through NEP-141. The Intents verifier can recredit the original
withdrawal owner. **Never use plain `ft_transfer` to send USDC to the escrow.**
It creates neither a registration nor a recoverable credit.

The escrow reserves storage for open seats and future refunds.

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
sign-in); NEAR Intents and the 1Click API; Sputnik DAO v2 (DAO hosts and the
dispute council); Upstash Redis and Vercel for the off-chain parts. UI: SL UI Library components (MIT, vendored in
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

