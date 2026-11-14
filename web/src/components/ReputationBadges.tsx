"use client";

import type { ReactNode } from "react";
import { useReputation } from "@/lib/reputation";
import type { Reputation } from "@/lib/reputationShared";

const plural = (n: number) => `${n} event${n === 1 ? "" : "s"}`;

/** Pills next to a name that say the numbers in words; more detail shows in the shared tooltip on hover, focus or tap. */
export function ReputationBadges({ attended, hosted = 0, guestsCame = 0, noShows = 0, showUp, small = false }: {
  attended: number | null;
  hosted?: number;
  guestsCame?: number;
  noShows?: number;
  /** Closed paid events the person registered for and how many they came to. */
  showUp?: { came: number; of: number };
  small?: boolean;
}) {
  if (attended === null && !hosted) return null;
  if (!attended && !hosted && !noShows) {
    return <Badge small={small} tone="bg-border/60 text-muted" label="New" tip="No events yet" sub="Nobody has checked them in at an event so far" />;
  }
  const came = showUp && showUp.of > 0 ? `Came to ${showUp.came} of ${showUp.of}` : noShows > 0 ? `Missed ${plural(noShows)}` : undefined;
  return (
    <>
      {attended !== null && (attended > 0 || noShows > 0) && (
        <Badge small={small} tone="bg-good/15 text-good" label={`${attended} attended`} tip={`Attended ${plural(attended)}`}
          sub={came ? `${came} · checked in on NEAR` : "Checked in at the door, recorded on NEAR"}
          icon={<path d="M20 6 9 17l-5-5" />} />
      )}
      {hosted > 0 && (
        <Badge small={small} tone="bg-accent-soft text-accent" label={`${hosted} hosted`} tip={`Held ${plural(hosted)}`}
          sub={guestsCame > 0 ? `${guestsCame} guest${guestsCame === 1 ? "" : "s"} came` : undefined}
          icon={<path d="M5 21V4h11l-2 4 2 4H5" />} />
      )}
    </>
  );
}

/** The badges of any account, loaded by itself; drop it next to a name. Shows nothing while loading. */
export function Rep({ account, small = true }: { account: string; small?: boolean }) {
  const rep = useReputation(account);
  return rep ? <ReputationBadges small={small} {...rep} /> : null;
}

/** One line of the same numbers, for places that take only text (the avatars widget). */
export const repLine = (r: Reputation | null | undefined) =>
  !r ? "" : !r.attended && !r.hosted && !r.noShows ? "New" : [(r.attended || r.noShows) && `${r.attended} attended`, r.hosted && `${r.hosted} hosted`].filter(Boolean).join(" · ");

function Badge({ label, tip, sub, tone, icon, small }: { label: string; tip: string; sub?: string; tone: string; icon?: ReactNode; small: boolean }) {
  return (
    <span
      tabIndex={0}
      data-tooltip={sub ? `${tip}\n${sub}` : tip}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent ${small ? "h-5 px-1.5 text-xs" : "h-6 px-2 text-[13px]"} ${tone}`}
    >
      {icon && <svg aria-hidden="true" width={small ? 11 : 13} height={small ? 11 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>}
      {label}
    </span>
  );
}
