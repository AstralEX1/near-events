"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { EventView } from "@/lib/near";
import { aiPrompt, buttonCode, checkoutLink, eventPageLink } from "@/lib/integration";
import { Cover } from "./ui";
import { Snippet } from "./Snippet";

/**
 * Shown once an event exists. Coming from the Integrate flow, the code for the
 * host's site is the point of the screen, so it goes first; from plain /create, the links do.
 */
export function EventSetup({ event, integrate }: { event: EventView; integrate: boolean }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const target = { origin, eventId: event.id };

  const siteCode = (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Add registration to your site</h2>
      <Snippet
        title="Button code"
        note="Paste it where your site shows the event. Guests can return to the same button for their QR pass or payout."
        code={origin ? buttonCode(target) : ""}
        primary={integrate}
      />
      <Snippet
        title="AI prompt"
        note="Send this to the coding agent working on your site. It adds the button for you."
        code={origin ? aiPrompt(target, event.mode ?? "Deposit") : ""}
        long
      />
    </section>
  );

  const links = (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Links</h2>
      <Snippet
        title="Registration link"
        note="Use this in a message, or where your site builder does not allow scripts."
        code={origin ? checkoutLink(target) : ""}
      />
      <Snippet
        title="Event page"
        note="Your full event page on Near Me."
        code={origin ? eventPageLink(target) : ""}
      />
      <div className="flex flex-wrap gap-3 pt-1">
        <Link href={`/e/${event.id}`} className="btn btn-primary">
          Open event page
        </Link>
        <Link href={`/e/${event.id}/manage`} className="btn btn-ghost">
          Manage guests &amp; check-in
        </Link>
      </div>
    </section>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-16">
      <div className="flex gap-4 items-center">
        <Cover event={event} className="w-20 h-20 rounded-xl shrink-0 [&>span]:hidden" />
        <div className="min-w-0">
          <div className="text-sm text-good font-medium">✓ Event created</div>
          <h1 className="text-2xl font-semibold tracking-tight break-words">{event.metadata.title}</h1>
        </div>
      </div>
      {integrate ? (
        <>
          {siteCode}
          {links}
        </>
      ) : (
        <>
          {links}
          {siteCode}
        </>
      )}
    </div>
  );
}
