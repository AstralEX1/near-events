import type { Metadata } from "next";
import { Faq, Next, Section, Shot, Stack, Title } from "../parts";

export const metadata: Metadata = { title: "Reputation · Nearvent" };

export default function ReputationDocs() {
  return (
    <>
      <Title lead="Your record is the events you showed up for, checked in at the door and kept on NEAR.">Reputation</Title>

      <Section id="badges" title="Two badges">
        <div className="space-y-12">
          <Shot n={1} title="Next to every name" images={[{ src: "/docs/badges.png", w: 1304, h: 800, alt: "Guest list with Attended badges and First event" }]}>
            On profiles and in the host’s guest list. Tap a badge to see what it counts. Newcomers show “First event”.
          </Shot>
        </div>
        <Stack
          items={[
            { title: "✓ Attended", text: "Closed events where the door team checked you in.", tech: "final guest status Attended · get_guests" },
            { title: "⚑ Held", text: "Events you hosted and closed, and how many guests came.", tech: "status Finalized · attended_count" },
          ]}
        />
      </Section>

      <Section id="regulars" title="Regulars first">
        <div className="space-y-12">
          <Shot n={2} title="Let your regulars in first" images={[{ src: "/docs/regulars.png", w: 1304, h: 800, alt: "Registration card of a Regulars first event" }]}>
            Guests who came to your past events register first. Everyone else joins from a time you pick, or never with Regulars only.
          </Shot>
        </div>
        <Stack
          items={[
            {
              title: "You set the bar",
              text: "Came to at least N of your last events (up to 10), and optionally no no-shows.",
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
          <li>Nobody checked in at all? Everyone got the deposit back, so it isn’t a no-show.</li>
          <li>The record belongs to the account (<code className="font-mono text-[0.9em]">alice.near</code>, a 0x wallet). Linked wallets share a profile, not the record.</li>
        </ul>
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Where can I see someone’s record?", "On their profile: nearvent.site/u/<account>."],
            ["Can I hide a no-show?", "No. It is in the escrow’s final list of that event."],
            ["Does a ticket event count?", "Yes, when the door team checked you in there."],
          ]}
        />
      </Section>

      <Next from="/docs/reputation" />
    </>
  );
}
