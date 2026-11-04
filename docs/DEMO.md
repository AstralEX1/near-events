# Demo video script (≈2 minutes)

Record the screen of the running app (`npm --prefix web run dev`, testnet) plus one
mainnet clip once mainnet is live. Speak over it, or add captions. (2026-11-04, Cursor)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Home page | "Free meetups lose half their guests. Near Events: everyone puts down 5 USDC, people who show up split the pool. No fee." |
| 0:15–0:35 | Event page | "Deposits sit in a NEAR escrow — not with the host. Same small deposit for every guest." |
| 0:35–0:55 | Click *Continue with Google*, then *Register · 5 USDC* | "No wallet needed: I log in with Google, NEAR Auth gives me an account, and I register in one click." |
| 0:55–1:15 | *Pay from any chain* screen | "Or pay with ETH on Base, or anything else: NEAR Intents swaps it to exactly 5 USDC and registers me in the same transfer. MetaMask users sign one intent, no gas." |
| 1:15–1:35 | Co-host on *Manage & check in* | "At the door the host or co-host checks people in. The page shows what each attendee will get." |
| 1:35–1:50 | Host *Close event & pay out* | "After the event the host closes it. The pool is split between the people who came." |
| 1:50–2:00 | `/me` balance, *Send to NEAR Intents* | "Winnings go to NEAR Intents with one button, and from there to any chain. Built at NEAR HACKATHON." |

Prep before recording:
- Seed a fresh event: `node web/scripts/seed-demo.mjs` (env vars in README).
- Use a second browser profile for the co-host so both views are signed in.
