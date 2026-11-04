# Near Events: show up, split the pool

Kickback-style events on NEAR. Every guest puts down the same small USDC deposit.
Guests who show up get their deposit back plus an equal share of the no-shows'
deposits. No platform fee.

- Pay from any chain or token: NEAR Intents (1Click) swaps to exactly the
  deposit and delivers it to the escrow, which registers the guest in the same step.
- No wallet needed: sign in with Google, email or passkey (NEAR Auth), any
  NEAR wallet, or MetaMask or any EVM wallet. With an EVM wallet your account is your NEAR
  Intents account (`0x…`), you register by signing one intent, and our relayer
  pays the gas.
- Payouts to any chain: one button moves winnings into the guest's NEAR Intents
  balance, from where they swap or withdraw to any chain.
- Host is a person (NEAR account) with optional co-hosts at the door.
- Escrow: deposits sit in a Rust contract. The host cannot take the
  pool, only decide who showed up. If the host disappears, anyone can refund
  everyone after a grace period.

Hackathon track focus: Real-World Money (USDC, 1Click, gasless onboarding).

## Live on testnet

| What | Account |
|---|---|
| Event escrow | [`escrow-v3.nearevents-11022103.testnet`](https://testnet.nearblocks.io/address/escrow-v3.nearevents-11022103.testnet) |
| Test USDC (open faucet) | [`usdc-nearevents-11022103.testnet`](https://testnet.nearblocks.io/address/usdc-nearevents-11022103.testnet) |

NEAR Intents has no testnet, so the full event cycle runs on testnet with test
USDC, and the 1Click / Intents paths are switched on for mainnet
(`NEXT_PUBLIC_NETWORK=mainnet`).

## Try it

```bash
cd web
cp .env.example .env.local      # testnet defaults; relayer vars are optional
npm install
npm run dev                     # http://localhost:3000
```

1. Open http://localhost:3000. You see open and past events read live from the
   testnet contract.
2. Open an event and click “Continue with Google or email” (or connect a NEAR
   wallet). You get a NEAR account; on testnet the relayer gives it a little NEAR
   for gas.
3. Click “Register · 5 USDC”. Missing test USDC is minted for you, then one
   `ft_transfer_call` puts the deposit in escrow. You now appear under “going”.
4. Create your own event at `/create`, add a friend as co-host.
5. As host or co-host open “Manage & check in guests”, tick who came, click
   *Check in*. The page shows what each attendee will receive.
6. Click “Finalize & pay out”. Attendees’ balances on `/me` grow by their share;
   they can withdraw to their NEAR wallet (or, on mainnet, into NEAR Intents to
   cash out on any chain).
7. “Pay from any chain” on an event shows a live 1Click price for paying the
   deposit with e.g. ETH on Base (dry quote on testnet).

Without a browser, the whole cycle runs from a script (uses your own testnet
accounts from `~/.near-credentials`):

```bash
cd web
EVENTS_CONTRACT=escrow-v3.nearevents-11022103.testnet USDC_CONTRACT=usdc-nearevents-11022103.testnet \
HOST_ACCOUNT=<you>.testnet GUEST_ACCOUNT=<friend>.testnet node scripts/smoke-testnet.mjs
```

Expected output ends with `"status":"Finalized"` and the guest's balance moving back
to their wallet.

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
guest ──(any chain via 1Click | USDC | Google login)──► escrow contract (NEAR)
                                                           │  ft_on_transfer: register
host / co-host ── create_event / check_in / finalize ─────► │
                                                           ▼
                         pool / attendees → internal balances → withdraw
                                                     (NEAR wallet or NEAR Intents)
```

Contract: `contracts/events/src/lib.rs` (74 unit tests in `tests.rs`).

**EVM wallet flow (mainnet):** the guest signs an ERC-191 intent
`ft_withdraw {token: USDC, receiver_id: escrow, msg: register}`; `/api/intents/execute`
checks it is only a Near Events registration and submits it to `intents.near`
(`execute_intents`), which calls `ft_transfer_call` on the escrow.

| Method | Who | What |
|---|---|---|
| `create_event(metadata, deposit, capacity, cohosts)` | anyone (caller = host) | free; contract pays storage from its own balance; max 5 open events per host, deposit ≥ 0.1 USDC |
| `ft_transfer_call` → `ft_on_transfer` | guest / friend / 1Click / intents.near | `{"action":"register","event_id":N,"guest":"..."}` or `{"action":"top_up",...}` |
| `check_in`, `undo_check_in` | host, co-hosts (+1 yocto) | mark who showed up; check-in batch ≤ capacity |
| `finalize` | host (+1 yocto) | pool ÷ attendees to balances; remainder to host; nobody came → full refund |
| `cancel`, `refund_if_abandoned` | host (+1 yocto) / anyone after 30 days | refund every guest deposit |
| `cleanup_event(event_id, limit)` | anyone, 7 days after close | deletes up to 100 guest records so their storage NEAR returns to the contract; payouts stay on balances |
| `register_with_balance` | guest (+1 yocto) | reuse a payout for the next event |
| `withdraw(amount, receiver_id, to_intents)` | guest (+1 yocto) | to any NEAR account, or into NEAR Intents |
| `payout_to_intents(account_id)` | owner or configured relayer | moves that account's balance into *its own* Intents balance; how EVM-wallet guests get paid |

Init: `new(usdc, intents, relayer)`. `relayer` may be `null` on testnet until the web
relayer account is set. Privileged mutators require exactly 1 yoctoNEAR.

Safety notes: only the configured USDC is accepted; a payment made for someone
else (friend, 1Click, intents.near) never bounces, because a refund might not
reach the guest; it lands on the guest's balance instead. Capacity is capped at
300 so payout fits in one transaction. The pool is only the guests' deposits;
there is no sponsor or bonus top-up.

## Build and test

```bash
cd contracts
cargo test -p near-events                       # 74 unit tests
cargo test -p test-usdc                         # faucet guards
cargo test -p near-events-sandbox               # local NEAR sandbox
cd events && cargo near build non-reproducible-wasm
```

## Built with

Rust `near-sdk` 5.30 and `near-contract-standards`, `cargo-near`; Next.js 16,
React 19, Tailwind CSS 4; `near-api-js` 7 (and 5 for NEAR Auth);
`@hot-labs/near-connect` (wallets); `@fast-auth-near/*` (NEAR Auth); NEAR Intents
1Click API.

**AI disclosure:** the contract, web app, scripts and this README were written with
Claude (Anthropic) in Claude Code, directed and reviewed by the author.

## Hackathon work

All code here was written during NEAR HACKATHON, starting 2026-11-02. The empty
baseline is tagged `pre-hackathon` and the submitted state `hackathon-submission`;
the full diff is `pre-hackathon...hackathon-submission` (compare view on GitHub).

## License

MIT, see [LICENSE](LICENSE).

