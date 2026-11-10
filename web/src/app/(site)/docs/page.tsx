import Link from "next/link";
import { Cards, Faq, Next, Section, Shot, Title } from "./parts";

export default function DocsHome() {
  return (
    <>
      <Title lead="Guests put down a small deposit. Those who show up split it.">How Nearvent Works</Title>

      <div className="card bg-accent-soft border-transparent px-5 py-4 mb-12 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-medium">Try it now, no wallet needed</div>
          <div className="text-sm text-muted">Sign In → Try with a demo account. Test money included.</div>
        </div>
        <Link href="/create" className="btn btn-primary">Create Event</Link>
      </div>

      <Section id="flow" title="Four steps">
        <div className="space-y-10">
          <Shot n={1} src="/docs/create.png" w={1480} h={1080} title="Create an event">
            Stake to RSVP, sell tickets, or keep it free. Up to 50 seats costs the host nothing.
          </Shot>
          <Shot n={2} src="/docs/register.png" w={1304} h={506} title="Guests register">
            One click puts down the deposit in USDC.
          </Shot>
          <Shot n={3} src="/docs/pass.png" w={1304} h={722} title="Check in at the door">
            Guests show their QR. The host or door team marks them in.
          </Shot>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/docs/checkin.png" width={1840} height={156} alt="A guest marked as checked in" loading="lazy" className="w-full h-auto rounded-2xl border border-border -mt-6" />
          <Shot n={4} src="/docs/payout.png" w={1304} h={1030} title="Get paid">
            The host closes the event. Everyone who came gets their deposit back plus a share of the no-shows.
          </Shot>
        </div>
      </Section>

      <Section id="near" title="Built on NEAR">
        <Cards
          items={[
            ["Escrow contract", <>Holds every deposit. <Link href="/docs/contract" className="text-accent underline">How it works</Link></>],
            ["USDC", "A deposit keeps its value until the door."],
            ["NEAR Intents", "Pay and withdraw from any chain."],
            ["Google sign-in", "A real NEAR account, no seed phrase."],
          ]}
        />
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Who holds the money?", "A smart contract. Not Nearvent, not the host."],
            ["Can the host keep the deposits?", "No. The host only says who came."],
            ["Nobody showed up?", "Everyone gets their deposit back."],
            ["The host never closes the event?", "30 days after it ends, anyone can refund everyone."],
            ["I came but wasn’t checked in.", "Ask the host before they close the event."],
            ["Fees?", "None from Nearvent."],
          ]}
        />
      </Section>

      <Next from="/docs" />
    </>
  );
}
