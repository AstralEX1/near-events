import type { EventMode } from "./near";

// What a host pastes into their own site. The API these describe is web/public/embed.js.

export interface IntegrationTarget {
  origin: string;
  eventId: number | string;
  /** Optional page guests continue to after paying. */
  then?: string;
}

const escapeAttribute = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function buttonElement({ eventId, then }: IntegrationTarget): string {
  const attribute = then ? ` then="${escapeAttribute(then)}"` : "";
  return `<near-event event="${escapeAttribute(String(eventId))}" mode="button"${attribute}></near-event>`;
}

export function buttonCode(target: IntegrationTarget): string {
  return `<script src="${target.origin}/embed.js" async></script>\n${buttonElement(target)}`;
}

export function checkoutLink({ origin, eventId, then }: IntegrationTarget): string {
  return `${origin}/p/${eventId}${then ? `?then=${encodeURIComponent(then)}` : ""}`;
}

export function eventPageLink({ origin, eventId }: IntegrationTarget): string {
  return `${origin}/e/${eventId}`;
}

/** A complete prompt for the host's coding agent. The text outside the event-specific values mirrors docs/AI_INSTALL.md. */
export function aiPrompt(target: IntegrationTarget, mode: EventMode): string {
  const { origin, eventId } = target;
  const whatItIs =
    mode === "Ticket"
      ? "Nearvent lets guests register for an event by buying a USDC ticket; the host is paid after the event, and every guest gets their money back if it is cancelled."
      : "Nearvent lets guests register for an event by putting down a small refundable USDC deposit; people who show up get it back plus a share of the no-shows.";
  return `Add a Nearvent registration button to this website.

${whatItIs} This site already shows the event; the button opens the hosted checkout and can reopen the guest's pass or ${mode === "Ticket" ? "refund" : "claim"} page. It is a dependency-free script that defines a <near-event> custom element. Its usage notes are in the header comment of ${origin}/embed.js.

What to add:
1. Load the script once per page, before </body> or in <head>:
   <script src="${origin}/embed.js" async></script>
2. Put this element next to the event on the host page (event ${eventId}):
   ${buttonElement(target)}

Where to put it, depending on the stack:
- Plain HTML / static site: paste both lines into the page.
- Next.js: load the script with next/script (strategy="afterInteractive") in the layout or page, and render <near-event> as JSX. For TypeScript, declare it in a .d.ts:
  declare namespace React.JSX { interface IntrinsicElements { "near-event": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string> } }
- React (Vite/CRA): add the script tag to index.html; render <near-event> in a component (same TypeScript declaration).
- Vue / Nuxt: add the script to index.html or nuxt.config app.head; set compilerOptions.isCustomElement = (tag) => tag === "near-event".
- Svelte / Astro / Angular: add the script to the root HTML; in Angular add CUSTOM_ELEMENTS_SCHEMA to the component.
- WordPress, Webflow, Tilda, Wix, Squarespace: use a "Custom code" / "HTML embed" block with both lines.
- If the platform forbids scripts, use a direct checkout link: ${checkoutLink(target)}

Options (attributes on <near-event>): label="..." button text; accent="#hex"; radius="12". theme="light|dark|auto", font="geist|poppins|system" and display="serif" style the checkout window. Match accent, font and corners to this site's design. For an existing button, call NearEvents.open(${eventId}) on click instead of using the element.

If the site sets a Content-Security-Policy, allow: script-src ${origin}; frame-src ${origin}; connect-src ${origin}.

Optional: react to registrations (show a toast, send to analytics/CRM):
  window.addEventListener("near-events:registered", (e) => { /* e.detail = { eventId, accountId } */ });

Do not copy embed.js into the project or modify it; load it from ${origin}. Do not add any keys or secrets: none are needed.

When done, run the site locally, open the page, and confirm that the button opens Nearvent checkout. Tell me which files you changed.`;
}
