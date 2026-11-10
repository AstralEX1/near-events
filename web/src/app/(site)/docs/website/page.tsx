import type { Metadata } from "next";
import Link from "next/link";
import { Code, Section, Steps, Title } from "../parts";

export const metadata: Metadata = { title: "Your Website · Nearvent" };

const SITE = "https://www.nearvent.site";

export default function WebsiteDocs() {
  return (
    <>
      <Title lead="Keep your event page. Add one button, and guests register with a deposit right there.">
        Add Nearvent to Your Website
      </Title>

      <Section id="setup" title="Set it up">
        <Steps
          items={[
            ["Bring your event", <>Open <Link href="/widget" className="text-accent underline">Integrate</Link> and paste your Luma or BaliSquad link, or create a new event.</>],
            ["Copy the button", "Manage → Integration."],
            ["Paste it", "Any site with custom HTML: Webflow, Framer, WordPress, Tilda."],
          ]}
        />
      </Section>

      <Section id="button" title="The button">
        <Code>{`<script src="${SITE}/embed.js" async></script>
<near-event event="6" mode="button"></near-event>`}</Code>
        <p className="text-sm text-muted">After paying, the same button opens the guest’s QR, and later their payout.</p>
        <p>Your own form after paying? Add <code>then</code>:</p>
        <Code>{`<near-event event="6" mode="button"
  then="https://yoursite.com/register?account={account}&event={event}"></near-event>`}</Code>
      </Section>

      <Section id="links" title="No scripts allowed? Use a link">
        <p>Checkout: <code>{SITE}/p/6</code> · Event page: <code>{SITE}/e/6</code></p>
        <p className="text-sm text-muted">For a bio, an email or a QR at the venue.</p>
      </Section>
    </>
  );
}
