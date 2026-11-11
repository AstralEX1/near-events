# Demo video script (about 2 minutes)

Record on https://www.nearvent.site with Sign In → **Try with a demo account**.
The demo runs in the browser on made-up data (50 demo USDC, a past event with a
payout, your just-ended event to check in and close, upcoming Deposit / Ticket /
Free events) and touches no server, relayer or chain. The old testnet demo `/e/4`
is no longer on www. Do not present mainnet payments as live until the paid
checks in [`DEPLOY.md`](DEPLOY.md#mainnet-release) pass. (Updated 2026-11-11, Claude)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Home page | "Nearvent helps free-event hosts get a more reliable headcount. Guests who show up get their deposit back and share the no-show deposits." |
| 0:15–0:35 | Create and open an event | "The host creates the event for free. Deposits stay in the NEAR escrow, outside the host's control." |
| 0:35–0:55 | Register for an upcoming Deposit event with demo USDC, show the QR pass | "This is the built-in demo with made-up USDC; on the live site the same steps move real USDC." |
| 0:55–1:15 | Optional cross-chain clip, only after its smoke passes | "1Click first funds the guest's Intents account. The guest then confirms registration, so unused funds remain recoverable." |
| 1:15–1:35 | Your just-ended event → *Manage* → Guests check-in | "The host or door team checks people in without a transaction per guest. The server keeps the list until the event is over." |
| 1:35–1:50 | Host *Close event & pay out* after event end | "Once the event has ended and check-ins are settled, the host closes it. The contract credits the people who came." |
| 1:50–2:00 | *Withdraw* on the event page or `/me` | "Guests can withdraw their payout through the available Intents path. Built at NEAR HACKATHON." |

Before recording:
- Use a clean browser profile so no real wallet is signed in; Exit Demo when done.
- The cross-chain clip needs a real mainnet 1Click payment; leave it out until that check passes.
