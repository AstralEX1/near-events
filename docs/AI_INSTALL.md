# Install Near Me on any site with an AI agent

For a business owner who has a coding agent (Claude Code, Cursor, Codex,
Windsurf, Lovable, v0...). Open the agent **in your website's project** and
send it the prompt below. You don't need to read anything else.

Create or import the event in Near Me, then open its **Manage → Integration**
tab. This prompt is there, filled in for your event, ready to copy. To use the
text below by hand, replace
`https://YOUR-NEAR-ME-HOST` with your Near Me address and `EVENT_ID` with the
number from `/e/{id}`.

## The prompt

```text
Add a Near Me registration button to this website.

Near Me lets guests register for an event by putting down a small refundable USDC deposit; people who show up get it back plus a share of the no-shows. This site already shows the event; the button opens the hosted checkout and can reopen the guest's pass or claim page. It is a dependency-free script that defines a <near-event> custom element. Its usage notes are in the header comment of https://YOUR-NEAR-ME-HOST/embed.js.

What to add:
1. Load the script once per page, before </body> or in <head>:
   <script src="https://YOUR-NEAR-ME-HOST/embed.js" async></script>
2. Put this element next to the event on the host page (event EVENT_ID):
   <near-event event="EVENT_ID" mode="button" accent="#ff401f"></near-event>

Where to put it, depending on the stack:
- Plain HTML / static site: paste both lines into the page.
- Next.js: load the script with next/script (strategy="afterInteractive") in the layout or page, and render <near-event> as JSX. For TypeScript, declare it in a .d.ts:
  declare namespace React.JSX { interface IntrinsicElements { "near-event": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string> } }
- React (Vite/CRA): add the script tag to index.html; render <near-event> in a component (same TypeScript declaration).
- Vue / Nuxt: add the script to index.html or nuxt.config app.head; set compilerOptions.isCustomElement = (tag) => tag === "near-event".
- Svelte / Astro / Angular: add the script to the root HTML; in Angular add CUSTOM_ELEMENTS_SCHEMA to the component.
- WordPress, Webflow, Tilda, Wix, Squarespace: use a "Custom code" / "HTML embed" block with both lines.
- If the platform forbids scripts, use a direct checkout link: https://YOUR-NEAR-ME-HOST/p/EVENT_ID.

Options (attributes on <near-event>): mode="button" for only a button; label="..." button text; theme="light|dark|auto"; accent="#hex"; font="geist|poppins|system"; display="serif"; radius="12". Match accent, font and corners to this site's design. For an existing button, call NearEvents.open(EVENT_ID) on click instead of using the element.

If the site sets a Content-Security-Policy, allow: script-src https://YOUR-NEAR-ME-HOST; frame-src https://YOUR-NEAR-ME-HOST; connect-src https://YOUR-NEAR-ME-HOST.

Optional: react to registrations (show a toast, send to analytics/CRM):
  window.addEventListener("near-events:registered", (e) => { /* e.detail = { eventId, accountId } */ });

Do not copy embed.js into the project or modify it; load it from https://YOUR-NEAR-ME-HOST. Do not add any keys or secrets: none are needed.

When done, run the site locally, open the page, and confirm that the button opens Near Me checkout. Tell me which files you changed.
```

## What the agent will touch

Only your site: one script tag and one `<near-event>` element or a checkout link.
The agent adds no keys or packages and doesn't change the build. Deposits go
straight to the Near Me contract, so your site never handles money or secrets.

## Source files, if the agent asks

| File | What it is |
|---|---|
| `web/public/embed.js` | The whole widget script, no dependencies. Served at `/embed.js`. |
| `web/src/app/embed/e/[id]/page.tsx` | The deposit box inside the iframe |
| `web/src/app/embed/e/[id]/join/page.tsx` | The sign-up window |
| `web/src/app/api/embed/[id]/route.ts` | Public event summary JSON |
| `docs/EMBED.md` | Human docs: options, iframe, events, security |

Public code: https://github.com/AstralEX1/near-events
