"use client";

import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import type { EventMode } from "@/lib/near";
import { detectEventSource } from "@/lib/eventImport";
import { formUrl, parseMode, startUrl, validAmount } from "@/lib/flow";

const CARDS: { mode: EventMode; line: string; image: string }[] = [
  { mode: "Deposit", line: "Show up, get it back", image: "/create/deposit-mode.png" },
  { mode: "Ticket", line: "Guests pay, you earn", image: "/create/ticket-mode.png" },
];

/** The first screen of both flows: how guests pay and how much, plus the event link when integrating. */
export function StartStep({ widget, initial }: { widget: boolean; initial: { mode?: string | null; amount?: string | null; link?: string | null } }) {
  const router = useRouter();
  const [link, setLink] = useState(initial.link ?? "");
  const [mode, setMode] = useState<EventMode | null>(parseMode(initial.mode));
  const [amount, setAmount] = useState(initial.amount ?? "");
  const source = detectEventSource(link);
  const amountOk = validAmount(amount);
  const ready = !!mode && amountOk && (!widget || !!source);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !mode) return;
    const choice = { mode, amount, link: widget ? link.trim() : undefined };
    // Back from the form returns here with the choice still filled in.
    window.history.replaceState(null, "", startUrl(choice, widget));
    router.push(formUrl(choice));
  };

  return (
    <form onSubmit={submit} className="gc-start space-y-7 pb-12">
      <div className="space-y-2"><p className="gc-eyebrow">{widget ? "Integrate" : "Create an event"}</p><h1 className="gc-page-title">How will guests join?</h1><p className="text-muted">{widget ? "Bring your event over. Keep your own website." : "A little commitment, or a ticket. You choose."}</p></div>

      {widget && (
        <label className="block space-y-1.5">
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

      <div role="radiogroup" aria-label="Guests pay" className="grid grid-cols-2 gap-3">
        {CARDS.map((card) => (
          <label
            key={card.mode}
            className="gc-mode-card cursor-pointer p-2 sm:p-3"
            data-selected={mode === card.mode}
          >
            <input type="radio" name="guests-pay" className="sr-only" checked={mode === card.mode} onChange={() => setMode(card.mode)} />
            <div aria-hidden className="relative flex min-h-20 aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-accent-soft">
              <Image src={card.image} alt="" fill sizes="(max-width: 640px) 50vw, 320px" className="object-contain" />
            </div>
            <span className="block px-1 pt-3 pb-1 font-medium">{card.mode === "Deposit" ? "Attendance deposit" : "Paid ticket"}</span>
            <span className="block px-1 pb-1 text-sm text-muted">{card.line}</span>
          </label>
        ))}
      </div>

      <label className="block space-y-1.5">
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
      </label>

      <button className="btn btn-accent w-full !py-3 text-base font-medium" disabled={!ready}>
        {widget ? "Import" : "Continue"}
      </button>
    </form>
  );
}
