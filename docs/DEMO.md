# Demo video script (about 2 minutes)

As last recorded on 2026-11-06, record the app against testnet
(`npm --prefix web run dev`) after the `escrow-tp4` payment smoke passes. Do not
present mainnet payment or EVM flows as live until the release checks in
[`DEPLOY.md`](DEPLOY.md) pass. Add a separate
mainnet clip only after those checks. (Updated 2026-11-07, Codex)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Home page | "Near Me helps free-event hosts get a more reliable headcount. Guests who show up get their deposit back and share the no-show deposits." |
| 0:15–0:35 | Create and open an event | "The host creates the event for free. Deposits stay in the NEAR escrow, outside the host's control." |
| 0:35–0:55 | Connect a NEAR testnet wallet and register with faucet USDC | "This is the testnet flow with faucet USDC, not a live mainnet payment." |
| 0:55–1:15 | Optional cross-chain clip, only after its smoke passes | "1Click first funds the guest's Intents account. The guest then confirms registration, so unused funds remain recoverable." |
| 1:15–1:35 | Co-host on *Manage & check in* | "The host or co-host checks people in without a transaction per guest. The server keeps the list until the event is over." |
| 1:35–1:50 | Host *Close event & pay out* after event end | "Once the event has ended and check-ins are settled, the host closes it. The contract credits the people who came." |
| 1:50–2:00 | *Withdraw* on the event page or `/me` | "Guests can withdraw their payout through the available Intents path. Built at NEAR HACKATHON." |

Before recording:
- Run the testnet smoke against `escrow-tp4` and use the verified result; the deployment itself did not include a live payment.
- Seed a fresh event with `node web/scripts/seed-demo.mjs` (see the README for setup).
- Use a second browser profile for the co-host so both views are signed in.
