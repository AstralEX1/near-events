// The copy-paste prompt a host sends to their own coding agent (Claude Code,
// Cursor, Codex...) to add the embed to their site. Same text as docs/AI_INSTALL.md.
export function agentPrompt(origin: string, eventId: string, element: string): string {
  return `Add a Near Me registration widget to this website.

Near Me lets guests register for an event by putting down a small refundable USDC deposit; people who show up get it back plus a share of the no-shows. The widget is a dependency-free script that defines a <near-event> custom element. Full reference for agents: ${origin}/llms.txt

What to add:
1. Load the script once per page, before </body> or in <head>:
   <script src="${origin}/embed.js" async></script>
2. Put this element where the event should appear (event ${eventId}):
   ${element}

Where to put it, depending on the stack:
- Plain HTML / static site: paste both lines into the page.
- Next.js: load the script with next/script (strategy="afterInteractive") in the layout or page, and render <near-event> as JSX. For TypeScript, declare it in a .d.ts:
  declare namespace React.JSX { interface IntrinsicElements { "near-event": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string> } }
- React (Vite/CRA): add the script tag to index.html; render <near-event> in a component (same TypeScript declaration).
- Vue / Nuxt: add the script to index.html or nuxt.config app.head; set compilerOptions.isCustomElement = (tag) => tag === "near-event".
- Svelte / Astro / Angular: add the script to the root HTML; in Angular add CUSTOM_ELEMENTS_SCHEMA to the component.
- WordPress, Webflow, Tilda, Wix, Squarespace: use a "Custom code" / "HTML embed" block with both lines.
- If the platform forbids scripts, use the iframe instead:
  <iframe src="${origin}/embed/e/${eventId}" title="Event registration" loading="lazy" style="width:100%;max-width:560px;height:260px;border:0"></iframe>

If this site already has its own registration (Luma, Typeform, Google Forms, a signup page), keep it: add then="<that registration URL>" so guests pay the deposit first and then continue to the usual form. Use {account} in that URL if the form can take a reference, e.g. ?ref={account}.

Options (attributes on <near-event>): mode="button" for only a button; label="..." button text; theme="light|dark|auto"; accent="#hex"; font="geist|poppins|system"; display="serif"; radius="12". Match accent, font and corners to this site's design. For an existing button, call NearEvents.open(${eventId}) on click instead of using the element.

If the site sets a Content-Security-Policy, allow: script-src ${origin}; frame-src ${origin}; connect-src ${origin}.

Optional: react to registrations (show a toast, send to analytics/CRM):
  window.addEventListener("near-events:registered", (e) => { /* e.detail = { eventId, accountId } */ });

Do not copy embed.js into the project or modify it; load it from ${origin}. Do not add any keys or secrets: none are needed.

When done, run the site locally, open the page, and confirm the event card (or button) renders and that clicking Register opens the Near Me sign-up window. Tell me which files you changed.`;
}
