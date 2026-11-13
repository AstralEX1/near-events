import Link from "next/link";
import { Faq, Next, Section, Shot, Stack, Title } from "./parts";

export default function DocsHome() {
  return (
    <>
      <Title lead="Guests put down a small deposit. Those who show up split it.">How Nearvent Works</Title>

      <div className="card bg-accent-soft border-transparent px-5 py-4 mb-12 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">Try it now, no wallet needed</div>
          <div className="text-sm text-muted">Made-up events and money, all in your browser.</div>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <Link href="/demo" className="btn btn-primary">Try Demo</Link>
          <Link href="/video" className="text-xs text-muted hover:text-text">▶ Watch Video · 0:30</Link>
        </div>
      </div>

      <Section id="flow" title="Four steps">
        <div className="space-y-12">
          <Shot n={1} title="Create an event" images={[{ src: "/docs/create.png", w: 1480, h: 1080, alt: "Choosing Stake to RSVP, Ticket or Free" }]}>
            Stake to RSVP, sell tickets, or keep it free. Up to 50 seats is free for the host.
          </Shot>
          <Shot n={2} title="Guests register" images={[{ src: "/docs/register.png", w: 1304, h: 506, alt: "Register button with a 0.1 USDC deposit" }]}>
            One click puts down the deposit in USDC.
          </Shot>
          <Shot
            n={3}
            title="Check in at the door"
            images={[
              { src: "/docs/pass.png", w: 1304, h: 722, alt: "Guest QR pass" },
              { src: "/docs/checkin.png", w: 1840, h: 156, alt: "Guest marked as checked in" },
            ]}
          >
            Guests show their QR. The host or door team marks them in.
          </Shot>
          <Shot n={4} title="Get paid" images={[{ src: "/docs/payout.png", w: 1304, h: 1030, alt: "Payout ready to withdraw" }]}>
            The host publishes who came. After 12 hours for disputes, everyone who came gets their deposit back plus a
            share of the no-shows.
          </Shot>
        </div>
      </Section>

      <Section id="near" title="How NEAR Powers It">
        <p className="text-muted">You never need to think about chains. Here is what happens underneath.</p>
        <Stack
          items={[
            {
              title: "Your deposit is safe",
              text: <>It sits in a smart contract, not with us or the host. The contract alone decides who gets paid. <Link href="/docs/contract" className="text-accent underline">Read the rules</Link></>,
              tech: "Rust escrow · near-sdk · USDC (NEP-141) via ft_transfer_call",
            },
            {
              title: "Pay from any chain",
              text: "Pay with ETH on Base or another supported token. It is swapped to USDC on NEAR and lands in your Intents balance, then one click registers you.",
              tech: "NEAR Intents · 1Click API → Intents balance → escrow",
            },
            {
              title: "MetaMask works, no NEAR needed",
              text: "Sign one message in your EVM wallet. We submit it and pay the gas. Your payout comes back to the same address.",
              tech: "ERC-191 intent → intents.near execute_intents · relayer payout_to_intents",
            },
            {
              title: "Cash out anywhere",
              text: "Withdraw to your NEAR wallet, keep it in NEAR Intents, or send it to another chain.",
              tech: "withdraw(to_intents) · 1Click deposit address",
            },
            {
              title: "Sign in with Google",
              text: "Google or email gives you a real NEAR account. No seed phrase, no extension. We pay the gas.",
              tech: "NEAR Auth (FastAuth) · MPC signer · implicit account · sponsored gas",
            },
            {
              title: "No pop-up for every guest",
              text: "Hosts prove who they are once. Checking in 300 people costs nothing; only the final list goes on-chain.",
              tech: "NEP-413 signed message · one finalize transaction",
            },
          ]}
        />
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Who holds the money?", "A smart contract. Not Nearvent, not the host."],
            ["Can the host keep the deposits?", "No. The host only says who came, and guests can dispute it."],
            ["Nobody showed up?", "Everyone gets their deposit back."],
            ["The host never publishes who came?", "3 days after the end, anyone can start the refund. Guests who came have 12 hours to prove it; everyone else gets the deposit back plus a share of the host’s bond."],
            ["I came but was marked absent.", "Open a dispute on the event page within 12 hours after the host publishes the list. It locks one deposit, and a council of 5 decides. If it agrees, you get your share, your deposit and part of the host’s bond."],
            ["Fees?", "None from Nearvent."],
          ]}
        />
      </Section>

      <Next from="/docs" />
    </>
  );
}
