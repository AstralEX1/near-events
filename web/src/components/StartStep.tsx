"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { detectEventSource } from "@/lib/eventImport";
import { formUrl, parseMode, startUrl, validAmount, type JoinMode } from "@/lib/flow";

// Icon paths from Lucide (ISC license): wallet, ticket and heart.
const CARDS: { mode: JoinMode; title: string; line: string; icon: string[] }[] = [
  { mode: "Deposit", title: "Stake to RSVP", line: "Show up, get it back", icon: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"] },
  { mode: "Ticket", title: "Ticket", line: "Guests pay, you earn", icon: ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"] },
  { mode: "Free", title: "Free", line: "Just RSVP, no crypto", icon: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"] },
];

/** The first screen of /create: how guests pay and how much. "Integrate instead?" adds the event link. */
export function StartStep({ widget: initialWidget, initial }: { widget: boolean; initial: { mode?: string | null; amount?: string | null; link?: string | null } }) {
  const router = useRouter();
  const [widget, setWidget] = useState(initialWidget);
  const [link, setLink] = useState(initial.link ?? "");
  const cards = widget ? CARDS.filter((card) => card.mode !== "Free") : CARDS;
  const [mode, setMode] = useState<JoinMode | null>(widget && initial.mode === "Free" ? null : parseMode(initial.mode));
  const free = mode === "Free";
  const [amount, setAmount] = useState(initial.amount ?? "");
  const source = detectEventSource(link);
  const amountOk = validAmount(amount);
  const ready = !!mode && (free || amountOk) && (!widget || !!source);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !mode) return;
    const choice = { mode, amount: free ? "" : amount, link: widget ? link.trim() : undefined };
    // Back from the form returns here with the choice still filled in.
    window.history.replaceState(null, "", startUrl(choice, widget));
    router.push(formUrl(choice));
  };

  return (
    <form onSubmit={submit} className="gc-start space-y-7 pb-12">
      <label className="gc-switch-row">
        <span>Integrate instead?</span>
        <button
          type="button"
          role="switch"
          aria-checked={widget}
          className="gc-switch"
          onClick={() => {
            setWidget(!widget);
            if (!widget && mode === "Free") setMode(null);
            // Refresh and Back keep the chosen flow.
            window.history.replaceState(null, "", startUrl({ mode: !widget && mode === "Free" ? undefined : mode ?? undefined, amount: amount || undefined, link: !widget ? link.trim() || undefined : undefined }, !widget));
          }}
        ><span aria-hidden /></button>
      </label>

      <div className="space-y-2"><p className="gc-eyebrow">{widget ? "Integrate" : "Create an event"}</p><h1 className="gc-page-title">How will guests join?</h1><p className="text-muted">{widget ? "Bring your event over. Keep your own website." : "A little commitment, a ticket, or free. You choose."}</p></div>

      {widget && (
        <label className="gc-reveal block space-y-1.5">
          <span className="flex items-baseline justify-between gap-3" aria-live="polite">
            <span className="label">Luma or BaliSquad event link</span>
            {source && <span className="text-sm text-good">✓ {source}</span>}
            {!source && link.trim() && <span className="text-sm text-warn">Not supported</span>}
          </span>
          <input
            autoFocus
            className="lu-field w-full px-3 py-2 text-sm"
            inputMode="url"
            autoComplete="off"
            placeholder="https://lu.ma/your-event"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
      )}

      <div role="radiogroup" aria-label="Guests pay" className={`grid gap-3 ${cards.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {cards.map((card) => (
          <label
            key={card.mode}
            className="gc-mode-card cursor-pointer p-2 sm:p-3"
            data-selected={mode === card.mode}
          >
            <input type="radio" name="guests-pay" className="sr-only" checked={mode === card.mode} onChange={() => setMode(card.mode)} />
            <span aria-hidden className="gc-mode-icon">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {card.icon.map((d) => <path key={d} d={d} />)}
              </svg>
            </span>
            <span className="block px-1 pt-4 pb-1 font-medium">{card.title}</span>
            <span className="block px-1 pb-1 text-sm text-muted">{card.line}</span>
          </label>
        ))}
      </div>

      {!free && <label className="block space-y-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="label">{mode === "Ticket" ? "Ticket price" : mode === "Deposit" ? "Deposit" : "Amount"}</span>
          {amount && !amountOk && <span className="text-sm text-warn">Min 0.1 USDC</span>}
        </span>
        <span className="lu-field flex items-center gap-2 px-3">
          <input
            className="flex-1 min-w-0 bg-transparent py-2 text-sm outline-none"
            inputMode="decimal"
            autoComplete="off"
            placeholder="10"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(",", ".").trim())}
          />
          <span className="text-sm text-muted">USDC</span>
        </span>
      </label>}

      <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={!ready}>
        {widget ? "Import" : "Continue"}
      </button>
    </form>
  );
}
