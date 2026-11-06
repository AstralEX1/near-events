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
    <div className="space-y-3">
      <Snippet title="Button code" code={origin ? buttonCode(target) : ""} primary />
      <Snippet title="AI prompt" code={origin ? aiPrompt(target, mode) : ""} long />
      <Snippet title="Registration link" code={origin ? checkoutLink(target) : ""} />
      <Snippet title="Event page" code={origin ? eventPageLink(target) : ""} />
    </div>
  );
}
