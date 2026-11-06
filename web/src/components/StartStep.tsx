"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import type { EventMode } from "@/lib/near";
import { detectEventSource } from "@/lib/eventImport";
import { formUrl, parseMode, startUrl, validAmount } from "@/lib/flow";

// Duotone icons from Phosphor (MIT, phosphoricons.com), inlined so they follow the theme colors.
const ICONS: Record<string, { faded: string; solid: string }> = {
  coins: {
    faded: "M240,132c0,19.88-35.82,36-80,36-19.6,0-37.56-3.17-51.47-8.44h0C146.76,156.85,176,142,176,124V96.72h0C212.52,100.06,240,114.58,240,132ZM176,84c0-19.88-35.82-36-80-36S16,64.12,16,84s35.82,36,80,36S176,103.88,176,84Z",
    solid: "M184,89.57V84c0-25.08-37.83-44-88-44S8,58.92,8,84v40c0,20.89,26.25,37.49,64,42.46V172c0,25.08,37.83,44,88,44s88-18.92,88-44V132C248,111.3,222.58,94.68,184,89.57ZM232,132c0,13.22-30.79,28-72,28-3.73,0-7.43-.13-11.08-.37C170.49,151.77,184,139,184,124V105.74C213.87,110.19,232,122.27,232,132ZM72,150.25V126.46A183.74,183.74,0,0,0,96,128a183.74,183.74,0,0,0,24-1.54v23.79A163,163,0,0,1,96,152,163,163,0,0,1,72,150.25Zm96-40.32V124c0,8.39-12.41,17.4-32,22.87V123.5C148.91,120.37,159.84,115.71,168,109.93ZM96,56c41.21,0,72,14.78,72,28s-30.79,28-72,28S24,97.22,24,84,54.79,56,96,56ZM24,124V109.93c8.16,5.78,19.09,10.44,32,13.57v23.37C36.41,141.4,24,132.39,24,124Zm64,48v-4.17c2.63.1,5.29.17,8,.17,3.88,0,7.67-.13,11.39-.35A121.92,121.92,0,0,0,120,171.41v23.46C100.41,189.4,88,180.39,88,172Zm48,26.25V174.4a179.48,179.48,0,0,0,24,1.6,183.74,183.74,0,0,0,24-1.54v23.79a165.45,165.45,0,0,1-48,0Zm64-3.38V171.5c12.91-3.13,23.84-7.79,32-13.57V172C232,180.39,219.59,189.4,200,194.87Z",
  },
  userCheck: {
    faded: "M168,100a60,60,0,1,1-60-60A60,60,0,0,1,168,100Z",
    solid: "M144,157.68a68,68,0,1,0-71.9,0c-20.65,6.76-39.23,19.39-54.17,37.17a8,8,0,0,0,12.25,10.3C50.25,181.19,77.91,168,108,168s57.75,13.19,77.87,37.15a8,8,0,0,0,12.25-10.3C183.18,177.07,164.6,164.44,144,157.68ZM56,100a52,52,0,1,1,52,52A52.06,52.06,0,0,1,56,100Zm197.66,33.66-32,32a8,8,0,0,1-11.32,0l-16-16a8,8,0,0,1,11.32-11.32L216,148.69l26.34-26.35a8,8,0,0,1,11.32,11.32Z",
  },
  handCoins: {
    faded: "M16,152H48v56H16a8,8,0,0,1-8-8V160A8,8,0,0,1,16,152ZM204,56a28,28,0,0,0-12,2.71h0A28,28,0,1,0,176,85.29h0A28,28,0,1,0,204,56Z",
    solid: "M230.33,141.06a24.43,24.43,0,0,0-21.24-4.23l-41.84,9.62A28,28,0,0,0,140,112H89.94a31.82,31.82,0,0,0-22.63,9.37L44.69,144H16A16,16,0,0,0,0,160v40a16,16,0,0,0,16,16H120a7.93,7.93,0,0,0,1.94-.24l64-16a6.94,6.94,0,0,0,1.19-.4L226,182.82l.44-.2a24.6,24.6,0,0,0,3.93-41.56ZM16,160H40v40H16Zm203.43,8.21-38,16.18L119,200H56V155.31l22.63-22.62A15.86,15.86,0,0,1,89.94,128H140a12,12,0,0,1,0,24H112a8,8,0,0,0,0,16h32a8.32,8.32,0,0,0,1.79-.2l67-15.41.31-.08a8.6,8.6,0,0,1,6.3,15.9ZM164,96a36,36,0,0,0,5.9-.48,36,36,0,1,0,28.22-47A36,36,0,1,0,164,96Zm60-12a20,20,0,1,1-20-20A20,20,0,0,1,224,84ZM164,40a20,20,0,0,1,19.25,14.61,36,36,0,0,0-15,24.93A20.42,20.42,0,0,1,164,80a20,20,0,0,1,0-40Z",
  },
  user: {
    faded: "M192,96a64,64,0,1,1-64-64A64,64,0,0,1,192,96Z",
    solid: "M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z",
  },
  ticket: {
    faded: "M200,128a32,32,0,0,0,32,32v32a8,8,0,0,1-8,8H96V56H224a8,8,0,0,1,8,8V96A32,32,0,0,0,200,128Z",
    solid: "M232,104a8,8,0,0,0,8-8V64a16,16,0,0,0-16-16H32A16,16,0,0,0,16,64V96a8,8,0,0,0,8,8,24,24,0,0,1,0,48,8,8,0,0,0-8,8v32a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V160a8,8,0,0,0-8-8,24,24,0,0,1,0-48ZM32,167.2a40,40,0,0,0,0-78.4V64H88V192H32Zm192,0V192H104V64H224V88.8a40,40,0,0,0,0,78.4Z",
  },
  wallet: {
    faded: "M224,80V192a8,8,0,0,1-8,8H56a16,16,0,0,1-16-16V56A16,16,0,0,0,56,72H216A8,8,0,0,1,224,80Z",
    solid: "M216,64H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,56V184a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V80A16,16,0,0,0,216,64Zm0,128H56a8,8,0,0,1-8-8V78.63A23.84,23.84,0,0,0,56,80H216Zm-48-60a12,12,0,1,1,12,12A12,12,0,0,1,168,132Z",
  },
};

function Picture({ icons }: { icons: string[] }) {
  const parts: ReactNode[] = [];
  icons.forEach((name, index) => {
    if (index) {
      parts.push(
        <svg key={`arrow-${index}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 sm:w-4 sm:h-4 shrink-0 opacity-40">
          <path d="M9 5l7 7-7 7" />
        </svg>,
      );
    }
    parts.push(
      <svg key={name} viewBox="0 0 256 256" fill="currentColor" className="w-8 h-8 sm:w-11 sm:h-11 shrink-0">
        <path d={ICONS[name].faded} opacity={0.2} />
        <path d={ICONS[name].solid} />
      </svg>,
    );
  });
  return (
    <div aria-hidden className="flex items-center justify-center gap-1 sm:gap-2 rounded-xl bg-accent-soft text-accent py-6 sm:py-8">
      {parts}
    </div>
  );
}

const CARDS: { mode: EventMode; line: string; icons: string[] }[] = [
  { mode: "Deposit", line: "Show up, get it back", icons: ["coins", "userCheck", "handCoins"] },
  { mode: "Ticket", line: "Guests pay, you earn", icons: ["user", "ticket", "wallet"] },
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
    <form onSubmit={submit} className="max-w-2xl mx-auto space-y-6 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">{widget ? "Add to your site" : "New event"}</h1>

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
            className={`cursor-pointer rounded-2xl border bg-surface p-2 sm:p-3 transition-colors focus-within:ring-2 focus-within:ring-accent/40 ${
              mode === card.mode ? "border-accent ring-1 ring-accent" : "border-border hover:border-accent/40"
            }`}
          >
            <input type="radio" name="guests-pay" className="sr-only" checked={mode === card.mode} onChange={() => setMode(card.mode)} />
            <Picture icons={card.icons} />
            <span className="block px-1 pt-3 pb-1 font-medium">{card.mode}</span>
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
