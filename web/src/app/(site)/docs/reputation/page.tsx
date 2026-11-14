import type { Metadata } from "next";
import { Faq, Next, Section, Shot, Stack, Title } from "../parts";

export const metadata: Metadata = { title: "Reputation · Nearvent" };

export default function ReputationDocs() {
  return (
    <>
      <Title lead="Your record is the events you showed up for, checked in at the door and kept on NEAR.">Reputation</Title>

      <Section id="badges" title="Next to every name">
        <Shot title="Hosts see it before the door opens" images={[{ src: "/docs/badges.png", w: 1320, h: 746, alt: "Guest list with 1 attended and 1 missed badges" }]}>
          In guest lists, Going and on profiles. Tap a badge for the details.
        </Shot>
        <Stack
          items={[
            { title: "✓ 3 attended", text: "Closed events where the door team checked them in.", tech: "final guest status Attended · get_guests" },
            { title: "✕ 1 missed", text: "Deposit events they paid for and didn’t come to.", tech: "Registered on a published list with check-ins" },
            { title: "⚑ 2 hosted", text: "Events they hosted and closed, and how many guests came.", tech: "status Finalized · attended_count" },
            { title: "New", text: "Nobody has checked them in yet." },
          ]}
        />
      </Section>

      <Section id="regulars" title="Regulars first">
        <Shot title="Let your regulars in first" images={[{ src: "/docs/regulars.png", w: 1256, h: 744, alt: "Registration card of a Regulars first event" }]}>
          Guests who came to your past events register first. Everyone else joins from a time you pick, or never with Regulars only.
        </Shot>
        <Stack
          items={[
            {
              title: "You set the bar",
              text: "Came to at least N of your last events (up to 10), and optionally never missed one.",
              tech: "AccessRule { past_events, min_attended, max_no_shows, open_to_all_at }",
            },
            {
              title: "The escrow checks it",
              text: "Every registration, also from MetaMask through NEAR Intents. Going around the site doesn’t help.",
              tech: "create_event(access) · check_access",
            },
          ]}
        />
      </Section>

      <Section id="fair" title="What counts">
        <ul className="list-disc pl-5 space-y-1">
          <li>Only public escrow records, so anyone can recount them.</li>
          <li>Free events don’t count: they live on our server, not on NEAR.</li>
          <li>An event the host never published a list for counts for nobody.</li>
          <li>Nobody checked in at all? Everyone got the deposit back, so nobody missed it.</li>
          <li>The record belongs to the account (<code className="font-mono text-[0.9em]">alice.near</code>, a 0x wallet). Linked wallets share a profile, not the record.</li>
        </ul>
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Where can I see someone’s record?", "On their profile: nearvent.site/u/<account>."],
            ["Can I hide a missed event?", "No. It comes from the escrow’s final list of that event."],
            ["Does a ticket event count?", "Yes for attended, when the door team checked you in. Only deposit events count as missed."],
          ]}
        />
      </Section>

      <Next from="/docs/reputation" />
    </>
  );
}
