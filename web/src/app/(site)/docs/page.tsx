import Link from "next/link";
import { Ext, Faq, Next, Section, Steps, Table, Title } from "./parts";

export default function DocsHome() {
  return (
    <>
      <Title lead="Free events lose half their guests. Nearvent asks everyone for a small deposit and gives it back to the people who come.">
        How Nearvent Works
      </Title>

      <Section id="idea" title="The idea">
        <p>
          Every guest puts down the same small deposit in USDC when they register. At the door the host checks people in.
          After the event, the people who came get their deposit back plus an equal share of the deposits of those who
          didn’t. Nobody pays a fee to Nearvent.
        </p>
        <p>There are three kinds of events:</p>
        <Table
          head={["Kind", "Guest pays", "After the event"]}
          rows={[
            ["Deposit", "A deposit, e.g. 5 USDC", "Guests who came split the whole pool"],
            ["Ticket", "A ticket price", "The money goes to the host"],
            ["Free", "Nothing", "Just an RSVP list"],
          ]}
        />
      </Section>

      <Section id="try" title="Try it in two minutes">
        <p>
          Press <b>Sign In → Try with a demo account</b>. You get a fresh account with test USDC already on it. Every
          action signs on its own, so you can click through the whole flow without a wallet.
        </p>
        <Steps
          items={[
            ["Create an event", <>Open <Link href="/create" className="text-accent underline">Create Event</Link>, pick Stake to RSVP, set 0.1 USDC, press Create Event.</>],
            ["Register as a guest", "Open the event link in a private window, sign in with another demo account, press Register."],
            ["Check the guest in", "Back as the host: Manage → Guests → Check in."],
            ["Close the event", "Manage → Close event & pay out. The pool is split on-chain."],
            ["Withdraw", "As the guest, open the event and press Withdraw."],
          ]}
        />
        <p className="text-sm text-muted">Each of these steps is a real NEAR transaction you can open in the explorer.</p>
      </Section>

      <Section id="guests" title="Going to an event">
        <Steps
          items={[
            ["Find an event", <>Open the link from the host, or browse <Link href="/events" className="text-accent underline">Explore</Link>.</>],
            ["Sign in", "Google or email works without any crypto: we create a NEAR account for you. A NEAR or EVM wallet works too."],
            ["Put down the deposit", "Press Register and pay in USDC. You can also pay from another chain through NEAR Intents."],
            ["Show your QR at the door", "The host scans it and marks you as here."],
            ["Get your money", "When the host closes the event, press Withdraw: your deposit plus your share of the no-shows."],
          ]}
        />
      </Section>

      <Section id="hosts" title="Hosting an event">
        <Steps
          items={[
            ["Create or import", "Fill in title, time, place, deposit and seats, or paste a Luma or BaliSquad link. Up to 50 seats is free."],
            ["Share", <>Send the link, or add a registration button to your own site (<Link href="/docs/website" className="text-accent underline">how</Link>).</>],
            ["Check people in", "On the day open Manage → Scan QR codes. Add friends as your door team so they can scan too. Check-ins cost nothing: no transaction per guest."],
            ["Close the event", "After it ends, review the list and close. Payouts go out in one transaction."],
          ]}
        />
      </Section>

      <Section id="near" title="What runs on NEAR">
        <Table
          head={["Part", "Why"]}
          rows={[
            ["Escrow smart contract", <>Holds every deposit and pays out by fixed rules. <Link href="/docs/contract" className="text-accent underline">Details</Link></>],
            ["USDC", "A deposit is worth the same at the door as when you paid it."],
            [<Ext key="i" href="https://docs.near-intents.org">NEAR Intents · 1Click</Ext>, "Pay and withdraw from other chains and tokens."],
            ["NEAR Auth", "Google or email sign-in creates a real NEAR account, no seed phrase."],
            ["Gas sponsoring", "New accounts get a little NEAR for gas from our relayer, so guests never buy NEAR."],
          ]}
        />
        <p className="text-sm text-muted">
          Names, descriptions, photos and door check-ins are kept on the Nearvent server. The contract keeps only what
          money depends on: title, time, deposit, guests and who came.
        </p>
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Who holds the money?", "A NEAR smart contract. Not Nearvent and not the host. Every deposit and payout is public on-chain."],
            ["Can the host keep the deposits?", "No. In Deposit mode the host can only say who came. The contract splits the pool between those guests."],
            ["What if nobody shows up?", "Everyone gets their deposit back."],
            ["What if the host never closes the event?", "30 days after it ends, anyone can trigger a full refund."],
            ["Can I cancel after registering?", "No, that is what makes people come. If the host cancels, everyone gets their deposit back."],
            ["I came but wasn’t checked in.", "Tell the host before they close the event; they can still add you."],
            ["Is there a fee?", "No platform fee. Network fees are tiny and sponsored for new accounts."],
            ["Is there a time limit to withdraw?", "No. Your money stays on your balance until you take it."],
          ]}
        />
      </Section>

      <Next from="/docs" />
    </>
  );
}
