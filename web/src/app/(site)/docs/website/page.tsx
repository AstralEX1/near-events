import type { Metadata } from "next";
import Link from "next/link";
import { Code, Section, Steps, Title } from "../parts";

export const metadata: Metadata = { title: "Your Website · Nearvent" };

const SITE = "https://www.nearvent.site";

export default function WebsiteDocs() {
  return (
    <>
      <Title lead="Already have an event page on your own site, Luma or Notion? Keep it. Add a Nearvent button and guests register with a deposit right from there.">
        Add Nearvent to Your Website
      </Title>

      <Section id="setup" title="Set it up">
        <Steps
          items={[
            ["Bring your event", <>Open <Link href="/widget" className="text-accent underline">Integrate</Link> and paste your Luma or BaliSquad link, or create a new event.</>],
            ["Copy the button", "In the event’s Manage → Integration tab, copy the code below with your event number."],
            ["Paste it on your page", "Any site that allows custom HTML works: Webflow, Framer, WordPress, Tilda, plain HTML."],
          ]}
        />
      </Section>

      <Section id="button" title="The button">
        <Code>{`<script src="${SITE}/embed.js" async></script>
<near-event event="6" mode="button"></near-event>`}</Code>
        <p>
          It shows the deposit and opens Nearvent checkout. After paying, the same button becomes <b>View pass / claim</b>:
          guests reopen their QR there, and after the event they collect their payout or refund.
        </p>
        <p>Need guests to fill in your own form after paying? Add a <code>then</code> link:</p>
        <Code>{`<near-event event="6" mode="button"
  then="https://yoursite.com/register?account={account}&event={event}"></near-event>`}</Code>
      </Section>

      <Section id="links" title="No scripts allowed? Use a link">
        <p>Checkout: <code>{SITE}/p/6</code> · Event page: <code>{SITE}/e/6</code></p>
        <p className="text-sm text-muted">Works in a bio, an email, a message or a QR code at the venue.</p>
      </Section>
    </>
  );
}
