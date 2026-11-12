import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/EventSections";
import { Snippet } from "@/components/Snippet";
import { Code, Section, Steps, Title } from "../parts";

export const metadata: Metadata = { title: "Integrate · Nearvent" };

const SITE = "https://www.nearvent.site";
// Lucide "bot" and "arrow-up-right".
const BOT = ["M12 8V4H8", "M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M2 14h2", "M20 14h2", "M15 13v2", "M9 13v2"];
const ARROW = ["M7 7h10v10", "M7 17 17 7"];

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
        <a href={`${SITE}/llms.txt`} target="_blank" rel="noreferrer" className="card flex items-center gap-4 px-5 py-4 transition-colors hover:border-accent">
          <span className="w-10 h-10 shrink-0 rounded-full bg-accent-soft text-accent flex items-center justify-center"><Icon paths={BOT} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Guide for AI agents</span>
            <span className="block text-sm text-muted">Every stack, option and event in one file: <span className="font-mono text-[0.9em] text-text">llms.txt</span></span>
          </span>
          <span className="text-accent"><Icon paths={ARROW} size={18} /></span>
        </a>
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
