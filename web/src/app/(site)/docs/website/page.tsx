import type { Metadata } from "next";
import Link from "next/link";
import { Snippet } from "@/components/Snippet";
import { Code, Section, Steps, Title } from "../parts";

export const metadata: Metadata = { title: "Integrate Into Your Website · Nearvent" };

const SITE = "https://www.nearvent.site";

// Short on purpose: the agent reads the details (per-stack placement, attributes) from llms.txt.
const PROMPT = `Add a Nearvent registration button to this website.

Context
- Nearvent runs event sign-up with a USDC deposit or ticket; checkout is hosted on ${SITE}.
- My event ID: EVENT_ID
- Guide for coding agents: ${SITE}/llms.txt (read it first).

Task
1. Find the page that shows this event. If it is unclear which one, ask me before editing.
2. Load ${SITE}/embed.js once on that page (async), the way this stack adds third-party scripts.
3. Place <near-event event="EVENT_ID" mode="button"></near-event> where guests sign up.
4. Match the site's colors and corners with the accent and radius attributes.

Rules
- Load embed.js from ${SITE}; never copy or edit it.
- No packages, API keys or backend changes; none are needed.
- If the site sets a Content-Security-Policy, allow ${SITE}.

Done when the page runs locally and a click on the button opens Nearvent checkout. Reply with the files you changed.`;

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

      <Section id="ai" title="Or let your AI agent do it">
        <p className="text-sm text-muted">Paste into Claude Code, Cursor or Codex and put your event number in place of EVENT_ID.</p>
        <Snippet title="AI prompt" code={PROMPT} long />
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
