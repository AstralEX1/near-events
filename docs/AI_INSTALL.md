# Install Near Events on any site with an AI agent

For a business owner who has a coding agent (Claude Code, Cursor, Codex,
Windsurf, Lovable, v0...). Open the agent **in your website's project** and
send it the prompt below. Nothing else to read.

Easiest: open `/widget` in the Near Events app, pick your event and style, and
press **Copy** on "Have an AI agent do it". That prompt already has your event
number, colors and the real host address filled in.

Writing it by hand: replace `https://YOUR-NEAR-EVENTS-HOST` with the Near
Events address and `EVENT_ID` with your event number (it's in the event link,
`/e/6` → `6`).

## The prompt

```text
Add a Near Events registration widget to this website.

Near Events lets guests register for an event by putting down a small refundable USDC deposit; people who show up get it back plus a share of the no-shows. The widget is a dependency-free script that defines a <near-event> custom element. Its usage notes are in the header comment of https://YOUR-NEAR-EVENTS-HOST/embed.js.

What to add:
1. Load the script once per page, before </body> or in <head>:
   <script src="https://YOUR-NEAR-EVENTS-HOST/embed.js" async></script>
2. Put this element where the event should appear (event EVENT_ID):
   <near-event event="EVENT_ID" accent="#ff401f"></near-event>

Where to put it, depending on the stack:
- Plain HTML / static site: paste both lines into the page.
- Next.js: load the script with next/script (strategy="afterInteractive") in the layout or page, and render <near-event> as JSX. For TypeScript, declare it in a .d.ts:
  declare namespace React.JSX { interface IntrinsicElements { "near-event": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string> } }
- React (Vite/CRA): add the script tag to index.html; render <near-event> in a component (same TypeScript declaration).
- Vue / Nuxt: add the script to index.html or nuxt.config app.head; set compilerOptions.isCustomElement = (tag) => tag === "near-event".
- Svelte / Astro / Angular: add the script to the root HTML; in Angular add CUSTOM_ELEMENTS_SCHEMA to the component.
- WordPress, Webflow, Tilda, Wix, Squarespace: use a "Custom code" / "HTML embed" block with both lines.
- If the platform forbids scripts, use the iframe instead:
  <iframe src="https://YOUR-NEAR-EVENTS-HOST/embed/e/EVENT_ID" title="Event registration" loading="lazy" style="width:100%;max-width:560px;height:260px;border:0"></iframe>

Options (attributes on <near-event>): mode="button" for only a button; label="..." button text; theme="light|dark|auto"; accent="#hex"; font="geist|poppins|system"; display="serif"; radius="12". Match accent, font and corners to this site's design. For an existing button, call NearEvents.open(EVENT_ID) on click instead of using the element.

If the site sets a Content-Security-Policy, allow: script-src https://YOUR-NEAR-EVENTS-HOST; frame-src https://YOUR-NEAR-EVENTS-HOST; connect-src https://YOUR-NEAR-EVENTS-HOST.

Optional: react to registrations (show a toast, send to analytics/CRM):
  window.addEventListener("near-events:registered", (e) => { /* e.detail = { eventId, accountId } */ });

Do not copy embed.js into the project or modify it; load it from https://YOUR-NEAR-EVENTS-HOST. Do not add any keys or secrets: none are needed.

When done, run the site locally, open the page, and confirm the event card (or button) renders and that clicking Register opens the Near Events sign-up window. Tell me which files you changed.
```

## What the agent will touch

Only your site: one script tag and one `<near-event>` element (or an iframe).
No keys, no packages, no build changes. The money flow lives in the Near Events
contract; your site never handles funds or secrets.

## Source files, if the agent asks

| File | What it is |
|---|---|
| `web/public/embed.js` | The whole widget script, no dependencies. Served at `/embed.js`. |
| `web/src/app/embed/e/[id]/page.tsx` | The event card inside the iframe |
| `web/src/app/embed/e/[id]/join/page.tsx` | The sign-up window |
| `web/src/app/api/embed/[id]/route.ts` | Public event summary JSON |
| `web/src/lib/agentPrompt.ts` | The prompt above, used by `/widget` |
| `docs/EMBED.md` | Human docs: options, iframe, events, security |

Public code: https://github.com/AstralEX1/near-events
