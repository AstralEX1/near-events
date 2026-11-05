# Near Events: show up, split the pool

Kickback-style events on NEAR. Every guest puts down the same small USDC deposit.
Guests who show up get their deposit back plus an equal share of the no-shows'
deposits. No platform fee, and creating an event is free.

- All money moves through NEAR Intents. Guests pay with USDC from a NEAR wallet
  or with almost any token on any chain (1Click swaps it to exactly the deposit),
  and cash out the same way: to any chain via 1Click, or to any NEAR Intents account.
- No wallet needed: sign in with Google or email through FastAuth and get a NEAR
  account behind the scenes. A NEAR wallet or MetaMask / any EVM wallet works too.
  With an EVM wallet your account is your NEAR Intents account (`0x…`), you
  register by signing one intent, and our relayer pays the gas.
- Free for hosts: the escrow pays the storage for a new event, so a host needs
  no NEAR to create one.
- The host is a person (any NEAR account) with optional co-hosts at the door.
- Escrow: deposits sit in a Rust contract on NEAR. The host cannot take the
  pool, only decide who showed up. If the host disappears, anyone can refund
  everyone after a grace period.

Hackathon track focus: Real-World Money (USDC, NEAR Intents, gasless onboarding).

## Live on testnet

| What | Account |
|---|---|
| Event escrow (the web app's default: deposits or paid tickets, check-in off-chain, `finalize` with the attendee list) | [`escrow-tp3.nearevents-11022103.testnet`](https://testnet.nearblocks.io/address/escrow-tp3.nearevents-11022103.testnet) |
| Test USDC (Tidepool faucet) | [`usdc.tidepool-sandbox.testnet`](https://testnet.nearblocks.io/address/usdc.tidepool-sandbox.testnet) |
| Older escrow code with on-chain check-in (kept for history): `escrow-tp2` (tickets), `escrow-tp` and `escrow-v3` (deposit only, our own test USDC `usdc-nearevents-11022103.testnet`) | not used by the app |

NEAR Intents itself has no testnet. On testnet the Intents paths run on
[Tidepool](https://www.usetidepool.tech/docs), a 1Click sandbox with the official
Intents verifier (`verifier.tidepool-sandbox.testnet`) and its own test USDC
(`usdc.tidepool-sandbox.testnet`). Tidepool drops the message that lets 1Click
register a guest in the same swap, so on testnet the RSVP is a direct test-USDC
transfer; cash-out through 1Click and into Intents accounts works there. Paying
and registering in one swap works on mainnet only (`NEXT_PUBLIC_NETWORK=mainnet`).

## Try it

```bash
cd web
cp .env.example .env.local      # testnet defaults; relayer vars are optional
npm install
npm run dev                     # http://localhost:3000
```

1. Open http://localhost:3000 and go to `/events`. Open and past events are read
   live from the testnet contract.
2. Open an event and click “Continue with Google or email” (or connect a wallet).
   You get a NEAR account; on testnet the relayer gives it a little NEAR for gas.
3. Click “Register · 5 USDC”. On testnet the test USDC comes from the faucet, then
   the deposit goes into the escrow and you appear under “going”.
4. Create your own event at `/create` (free) and add a friend as co-host.
5. As host or co-host open “Manage & check in guests” and tick who came. The
   first tick asks your wallet (or Google account) to sign a message once; the
   marks are kept on our server, no transaction per guest. The page shows what
   each attendee will receive.
6. Click “Close event & pay out”. This one transaction sends the list of who
   came to the contract, and each attendee's share lands on their balance.
7. Press Withdraw on the event page or `/me`: send the payout through NEAR
   Intents to any chain (via 1Click) or to any NEAR Intents account.

Without a browser, the whole cycle runs from a script (uses your own testnet
accounts from `~/.near-credentials`; Tidepool's faucet tops the guest up with test USDC):

```bash
cd web
export EVENTS_CONTRACT=escrow-tp3.nearevents-11022103.testnet HOST_ACCOUNT=<you>.testnet GUEST_ACCOUNT=<friend>.testnet
node scripts/smoke-intents-testnet.mjs   # deposit via 1Click → finalize(attended) → cash out to Base and into Intents
node scripts/smoke-tickets-testnet.mjs   # paid ticket → finalize after the start → cancel refunds
```

Both print each step and end with the payouts landing (checked on 2026-11-05).

## Embed on your website

Any business can take deposit-backed registrations on its own site with two lines:

```html
<script src="https://YOUR-NEAR-EVENTS-HOST/embed.js" async></script>
<near-event event="6" accent="#ff401f"></near-event>
```

Hosts get a code builder with live preview at `/widget`; there is an iframe
fallback, a bare `/p/{id}` payment link, and a `NearEvents.open(id)` call for
custom buttons. Details: [docs/EMBED.md](docs/EMBED.md). Have an AI agent
install it: [docs/AI_INSTALL.md](docs/AI_INSTALL.md).

## How it works

```
guest ──(any chain via 1Click | USDC from a NEAR wallet | Google login)──► NEAR Intents
                                                                              │
host / co-host ── create_event / finalize(attended) ──► escrow contract (NEAR)
                                                                              │
                   pool / attendees → internal balances → withdraw through Intents
                                   (any chain via 1Click, or any Intents account)
```

Contract: `contracts/events/src/lib.rs` (91 unit tests in `tests.rs`).

**EVM wallet flow (mainnet):** the guest signs an ERC-191 intent
`ft_withdraw {token: USDC, receiver_id: escrow, msg: register}`; `/api/intents/execute`
checks it is only a Near Events registration and submits it to `intents.near`
(`execute_intents`), which calls `ft_transfer_call` on the escrow.

| Method | Who | What |
|---|---|---|
| `create_event(metadata, deposit, capacity, cohosts)` | anyone (caller = host) | free: the contract pays storage from its own balance; max 5 open events per host, capacity ≤ 300, deposit ≥ 0.1 USDC; up to 10 co-hosts, fixed after creation |
| `ft_transfer_call` → `ft_on_transfer` | guest / friend / 1Click / intents.near | `{"action":"register","event_id":N,"guest":"..."}` |
| `refund_guest` | host (+1 yocto) | refund one guest who has not been checked in |
| `finalize(event_id, attended)` | host (+1 yocto) | `attended` = guests checked in at the door (kept off-chain on our server until now). Deposit: pool ÷ attendees, remainder to host, empty list → full refund. Ticket: all ticket money to the host after the start |
| `set_paused(paused)` | owner = the account that ran `new` (+1 yocto) | stops new events and registrations; payouts, refunds and withdrawals keep working |
| `cancel`, `refund_if_abandoned` | host (+1 yocto) / anyone after 30 days | refund every guest deposit |
| `cleanup_event(event_id, limit)` | anyone, 7 days after close | deletes up to 100 guest records so their storage NEAR returns to the contract; payouts stay on balances |
| `withdraw(amount, receiver_id, to_intents)` | guest (+1 yocto) | to a NEAR account (e.g. a 1Click deposit address) or into NEAR Intents |
| `payout_to_intents(account_id)` | owner or configured relayer | moves that account's balance into *its own* Intents balance; how EVM-wallet guests get paid |

Views include `storage_pool` (NEAR left for free event creation) and `open_events_of(account)`.

Init: `new(usdc, intents, relayer)`. `relayer` may be `null` until the web
relayer account is set. Privileged mutators require exactly 1 yoctoNEAR.

Safety notes: only the configured USDC is accepted; a payment made for someone
else (friend, 1Click, intents.near) never bounces, because a refund might not
reach the guest; it lands on the guest's balance instead. Capacity is capped at
300 so payout fits in one transaction. The pool is only the guests' deposits.

## Build and test

```bash
cd contracts
cargo test -p near-events                       # 91 unit tests
cargo test -p test-usdc                         # faucet guards
cargo test -p near-events-sandbox               # local NEAR sandbox
cd events && cargo near build non-reproducible-wasm
```

## Built with

Rust `near-sdk` 5.30 and `near-contract-standards`, `cargo-near`; Next.js 16,
React 19, Tailwind CSS 4; `near-api-js` 7 (and 5 for FastAuth);
`@hot-labs/near-connect` (wallets); `@fast-auth-near/*` (FastAuth, Google/email
sign-in); NEAR Intents and the 1Click API.

**AI disclosure:** the contract, web app, scripts and this README were written with
Claude (Anthropic) in Claude Code, directed and reviewed by the author.

## Hackathon work

All code here was written during NEAR HACKATHON, starting 2026-11-02. The empty
baseline is tagged `pre-hackathon` and the submitted state `hackathon-submission`;
the full diff is `pre-hackathon...hackathon-submission` (compare view on GitHub).

## License

MIT, see [LICENSE](LICENSE).

