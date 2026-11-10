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

## Try it in two minutes

Open **[www.nearvent.site](https://www.nearvent.site)** → **Sign In** → **Try with a
demo account**. You get a fresh NEAR account with a little NEAR for gas and
2 test USDC. Every action signs on its own (no wallet, no popups), and each one
is a real NEAR transaction you can open in the explorer.

1. **Create Event** → **Stake to RSVP** → 0.1 USDC → **Create Event**. → The event is on-chain.
2. Open the event link in a private window, take another demo account, press **Register**. → You show up under “Going”.
3. Back as the host: **Manage → Guests → Check in**. → No transaction: check-ins are kept off-chain.
4. **Manage → Close event & pay out**. → One transaction sends the list of who came; the pool is split on-chain.
5. As the guest, press **Withdraw**. → The deposit plus the no-shows’ share lands in your account.

User docs: [www.nearvent.site/docs](https://www.nearvent.site/docs) ·
smart contract: [/docs/contract](https://www.nearvent.site/docs/contract).

| What | Account |
|---|---|
| Event escrow | [`escrow-tp6.tp6-nv1110.testnet`](https://testnet.nearblocks.io/address/escrow-tp6.tp6-nv1110.testnet) (code hash `G8ym7g1tSQevzz9qXHynUvRyDHnxG3iBz8zxhdZ8ZUo2`) |
| Test USDC | [`usdc.tidepool-sandbox.testnet`](https://testnet.nearblocks.io/address/usdc.tidepool-sandbox.testnet) |

NEAR Intents has no testnet. On testnet the Intents paths run on
[Tidepool](https://www.usetidepool.tech/docs), a 1Click sandbox with the official
Intents verifier (`verifier.tidepool-sandbox.testnet`). Mainnet release checks
are still pending. Deployment and QA records: [docs/DEPLOY.md](docs/DEPLOY.md).

### Run it locally

```bash
cd web
cp .env.example .env.local      # server settings: docs/DEPLOY.md
npm install
npm run dev                     # http://localhost:3000
```

The demo account and Google sign-in need the relayer settings from
`docs/DEPLOY.md`; a NEAR wallet works without them.

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

