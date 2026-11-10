# Nearvent: show up, split the pool

Kickback-style events on NEAR. In Deposit mode, every guest puts down the same
small USDC deposit; guests who show up get it back plus an equal share of the
no-shows' deposits. Paid Ticket mode is also available. There is no platform
fee, and creating an event is free.

- Funds are held by a Rust escrow on NEAR. Mainnet cross-chain payments use NEAR
  Intents and 1Click; testnet uses Tidepool because NEAR Intents has no testnet.
  Mainnet 1Click first funds the guest's Intents account, then the guest confirms
  registration. Withdrawals can go through 1Click to another chain or to an
  Intents account.
- Guests can sign in with Google or email through FastAuth, use a NEAR wallet, or
  use an EVM wallet. Mainnet EVM and FastAuth release checks are still pending.
- Free tier for hosts: the escrow pays the storage for events up to 50 seats
  while the host has fewer than 2 open events. Bigger events (up to 300) or more
  open events cost the host a little NEAR for storage (~0.33 NEAR for 50 seats,
  ~1.95 NEAR for 300).
- Each guest's profile shows how many events they attended (an on-chain counter).
- The host is a person (any NEAR account) with an optional door team (co-hosts)
  kept on the Nearvent server; only the host can close or cancel.
- In Deposit mode the host records who showed up but cannot take the pool. In
  Ticket mode each ticket goes to the host's balance at registration and is
  never refunded. The host can cancel a Deposit event and refund everyone at
  any time; anyone can do it 30 days after the event ended if the host never
  closed it.
- A guest always pays for their own seat; only a payment relayed by NEAR
  Intents names the guest.

Hackathon track focus: Real-World Money (USDC, NEAR Intents, gasless onboarding).

## Live on testnet

The app uses the verified `escrow-tp4` deployment. A hosted test event verified
registration with faucet USDC, event-detail saving, and off-chain check-in.
The Vercel demo is [www.nearvent.site](https://www.nearvent.site/e/11);
it uses Upstash Redis for hosted event details and check-ins. The local env file
is `/Users/astralex/nearhackathon/web/.env.local` (git-ignored, mode 600); secret
values are not documented here. Mainnet release checks remain pending.

The slim TP5 contract is included in the current source and was verified
separately on a disposable testnet account. The hosted app still uses TP4;
TP5 has an incompatible state layout and needs a fresh account plus a separately
approved app switch. See [deployment and QA status](docs/DEPLOY.md).

| What | Account |
|---|---|
| Event escrow (the web app's default) | [`escrow-tp4.nearevents-11022103.testnet`](https://testnet.nearblocks.io/address/escrow-tp4.nearevents-11022103.testnet) |
| Test USDC (Tidepool faucet) | [`usdc.tidepool-sandbox.testnet`](https://testnet.nearblocks.io/address/usdc.tidepool-sandbox.testnet) |

NEAR Intents itself has no testnet. On testnet the Intents paths run on
[Tidepool](https://www.usetidepool.tech/docs), a 1Click sandbox with the official
Intents verifier (`verifier.tidepool-sandbox.testnet`) and its own test USDC
(`usdc.tidepool-sandbox.testnet`). The testnet UI uses a direct test-USDC transfer for NEAR wallets and the
Tidepool verifier for EVM wallets. On mainnet, 1Click funds the guest’s Intents
account first, and the guest confirms registration separately.

## Try it

```bash
cd web
cp .env.example .env.local      # add local server settings from docs/DEPLOY.md as needed
npm install
npm run dev                     # http://localhost:3000
```

For this workspace, that file is `/Users/astralex/nearhackathon/web/.env.local`.
It contains local Upstash connection settings and `APP_SECRET`; keep it private.

1. Open http://localhost:3000 and go to `/events`. Open and past events are read
   live from the testnet contract.
2. Open an event and connect a NEAR wallet. Google/email sign-in needs the
   FastAuth settings described in `docs/DEPLOY.md`.
3. Click “Register · 5 USDC”. On testnet the test USDC comes from the faucet, then
   the deposit goes into the escrow and you appear under “going”.
4. Create your own event at `/create` (free) and add a friend to the door team.
5. As host or door team open “Manage & check in guests” and tick who came. The
   first tick asks your wallet to sign a message once; the
   marks are kept on our server, no transaction per guest. The page shows what
   each attendee will receive.
6. After the event ends and check-ins are settled, click “Close event & pay out”.
   This transaction sends the attendance list to the contract and credits each
   attendee's share to their balance.
7. Press Withdraw on the event page or `/me`: send the payout through NEAR
   Intents to any chain (via 1Click) or to any NEAR Intents account.

The app reads and writes events through one escrow: `escrow-tp4.nearevents-11022103.testnet`.
Older escrow deployments are not queried or supported by the app. The old `escrow-tp3` events and balances remain testnet data and are not migrated.

Without a browser, the whole cycle runs from a script (uses your own testnet
accounts from `~/.near-credentials`; Tidepool's faucet tops the guest up with test USDC):

```bash
cd web
export EVENTS_CONTRACT=escrow-tp4.nearevents-11022103.testnet HOST_ACCOUNT=<you>.testnet GUEST_ACCOUNT=<friend>.testnet
node scripts/smoke-intents-testnet.mjs   # deposit via 1Click → finalize(attended) → cash out to Base and into Intents
node scripts/smoke-tickets-testnet.mjs   # paid ticket → host paid at registration → finalize → cancel refunds nothing
```

Those scripts last passed against an earlier testnet setup on 2026-11-05. Rerun
the current release smoke against `escrow-tp4` before relying on that result.

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

**EVM wallet flow (mainnet; release smoke pending):** the guest signs an ERC-191 intent
`ft_withdraw {token: USDC, receiver_id: escrow, msg: register}`; `/api/intents/execute`
checks it is only a Nearvent registration and submits it to `intents.near`
(`execute_intents`), which calls `ft_transfer_call` on the escrow.

| Method | Who | What |
|---|---|---|
| `create_event(metadata, deposit, capacity, mode)` | anyone (caller = host) | `metadata` = `{title, starts_at, ends_at}`. Payable. Free tier (≤ 50 seats and < 2 open events): the contract pays storage, attached NEAR is returned. Otherwise attach ≥ `create_event_cost`, the excess is returned. Capacity ≤ 300 (finalize gas), deposit ≥ 0.1 USDC. Title and times cannot be changed later |
| `ft_transfer_call` → `ft_on_transfer` | guest / verifier | `{"action":"register","event_id":N}`; `guest` only from the Intents verifier (from anyone else it must equal the sender, otherwise the whole amount is returned) |
| `finalize(event_id, attended)` | host (+1 yocto) | `attended` = guests checked in at the door (kept off-chain on our server until now). Deposit: pool ÷ attendees, remainder to host, empty list → full refund. Ticket: only closes; the host was paid at registration |
| `cancel(event_id)` | host any time while open; anyone after event end + 30 days (+1 yocto) | refund every deposit (Ticket: refunds nothing) |
| `withdraw(amount, receiver_id, to_intents)` | guest (+1 yocto) | to a NEAR account (e.g. a 1Click deposit address) or into NEAR Intents |
| `payout_to_intents(account_id)` | owner or configured relayer | moves that account's balance into *its own* Intents balance; how EVM-wallet guests get paid |

Views: `get_event`, `get_recent_events(limit ≤ 100)`, `get_guests`,
`get_guest_status`, `get_guest_statuses(account_id, event_ids ≤ 100)`, `balance_of`,
`create_event_cost(host, capacity)` (yoctoNEAR, 0 when free), `get_attended_count(account_id)`.
There is no pause, owner, event editing or single-guest refund. The door team,
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

All code here was written during NEAR HACKATHON, starting 2026-11-02. The empty
baseline is tagged `pre-hackathon` and the submitted state `hackathon-submission`;
the full diff is `pre-hackathon...hackathon-submission` (compare view on GitHub).

## License

MIT, see [LICENSE](LICENSE).

