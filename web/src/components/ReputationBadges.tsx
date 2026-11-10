"use client";

import { useId, type ReactNode } from "react";

const plural = (n: number) => `${n} event${n === 1 ? "" : "s"}`;

/** Small number pills next to a name; the meaning shows in a tooltip on hover, focus or tap. */
export function ReputationBadges({ attended, hosted = 0, guestsCame = 0, showUp, small = false }: {
  attended: number | null;
  hosted?: number;
  guestsCame?: number;
  /** Closed paid events the person registered for and how many they came to. */
  showUp?: { came: number; of: number };
  small?: boolean;
}) {
  return (
    <>
      {hosted > 0 && (
        <Badge small={small} tone="bg-accent-soft text-accent" value={hosted} tip={`Hosted ${plural(hosted)}`}
          sub={guestsCame > 0 ? `${guestsCame} guest${guestsCame === 1 ? "" : "s"} came` : undefined}
          icon={<path d="M5 21V4h11l-2 4 2 4H5" />} />
      )}
      {attended !== null && (
        <Badge small={small} tone="bg-good/15 text-good" value={attended} tip={`Attended ${plural(attended)}`}
          sub={showUp && showUp.of > 0 ? `Came to ${showUp.came} of ${showUp.of} · checked in on NEAR` : "Checked in at the door, recorded on NEAR"}
          icon={<path d="M20 6 9 17l-5-5" />} />
      )}
    </>
  );
}

function Badge({ value, tip, sub, tone, icon, small }: { value: number; tip: string; sub?: string; tone: string; icon: ReactNode; small: boolean }) {
  const id = useId();
  return (
    <span
      tabIndex={0}
      aria-describedby={id}
      className={`group relative inline-flex shrink-0 items-center gap-1 rounded-full font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent ${small ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-[13px]"} ${tone}`}
    >
      <svg aria-hidden="true" width={small ? 11 : 13} height={small ? 11 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      {value}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 scale-[.97] whitespace-nowrap rounded-lg bg-text px-2.5 py-1.5 text-left text-xs font-semibold leading-snug text-bg opacity-0 transition-[opacity,scale] duration-150 ease-out origin-top group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
      >
        {tip}
        {sub && <span className="block font-normal opacity-80">{sub}</span>}
      </span>
    </span>
  );
}
