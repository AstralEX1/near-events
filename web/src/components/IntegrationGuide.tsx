"use client";

import { useEffect, useState } from "react";
import type { EventMode } from "@/lib/near";
import { aiPrompt, buttonCode, checkoutLink, eventPageLink } from "@/lib/integration";
import { Snippet } from "./Snippet";

/** Everything a host needs to put one event on their own site. */
export function IntegrationGuide({ eventId, mode }: { eventId: number; mode: EventMode }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const target = { origin, eventId };
  return (
    <div className="space-y-5">
      <div className="space-y-2"><p className="gc-eyebrow">On your website</p><h2 className="text-2xl font-semibold tracking-tight">Same event. Your own front door.</h2><p className="text-sm text-muted">Add the button to your site, or share a direct checkout link. Guests use the same registration and QR pass.</p></div>
      <Snippet title="Button code" code={origin ? buttonCode(target) : ""} primary />
      <Snippet title="AI prompt" code={origin ? aiPrompt(target, mode) : ""} long />
      <Snippet title="Registration link" code={origin ? checkoutLink(target) : ""} />
      <Snippet title="Event page" code={origin ? eventPageLink(target) : ""} />
    </div>
  );
}
