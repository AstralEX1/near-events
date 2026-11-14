import type { ReactNode } from "react";
import Link from "next/link";
import { Avatar, shortAccount } from "./ui";
import { SlAvatars } from "./SlUi";
import { LocationValue } from "./PublicText";
import { goingLine, mapPlaceName, mapQuery } from "@/lib/eventLines";
import { displayName, type Profile } from "@/lib/profilesShared";
import { useReputations } from "@/lib/reputation";
import { Rep, repLine } from "./ReputationBadges";

// Event page blocks, after Luma's event page: a small muted label over a hairline,
// then the content. Shared by paid (/e/<id>) and free (/f/<id>) events.

export function Section({ label, id, children }: { label: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="label pb-2 mb-3 border-b border-border">{label}</h2>
      {children}
    </section>
  );
}

/** A host or door-team member: profile photo, name, @username and their numbers, linking to their page. */
export function PersonLink({ account, profile, note }: { account: string; profile?: Profile; note?: ReactNode }) {
  const name = displayName(profile);
  return (
    <Link href={`/u/${encodeURIComponent(account)}`} className="flex items-center gap-2 text-sm hover:text-accent">
      <Avatar account={account} src={profile?.avatar_url} seed={profile?.avatar_seed} size={24} />
      <span className="truncate font-medium">{name ?? shortAccount(account)}</span>
      {profile?.username && name !== `@${profile.username}` && <span className="truncate text-muted">@{profile.username}</span>}
      <Rep account={account} />
      {note}
    </Link>
  );
}

/** Who's going: guest photos come from their profiles; the name given at registration wins over the profile name. */
export function GoingList({ accounts, names = {}, profiles = {}, total, verb = "Going" }: { accounts: string[]; names?: Record<string, string>; profiles?: Record<string, Profile>; total: number; verb?: string }) {
  const reps = useReputations(accounts);
  if (!total || !accounts.length) return null;
  const stats = Object.fromEntries(Object.entries(reps).map(([a, r]) => [a, repLine(r)]));
  const all = Object.fromEntries(accounts.flatMap((a) => { const n = names[a] || displayName(profiles[a]); return n ? [[a, n]] : []; }));
  const shown = accounts.slice(0, 2).map((a) => all[a] || shortAccount(a));
  return (
    <Section label={`${total} ${verb}`}>
      {/* Remount when names, profiles or numbers arrive: the avatars widget keeps the first name it rendered. */}
      <SlAvatars key={`${Object.values(all).join("|")}#${Object.keys(profiles).join()}#${Object.values(stats).join()}`} accounts={accounts} names={all} profiles={profiles} stats={stats} role={verb === "Going" ? "Going · view profile" : "Went · view profile"} />
      <p className="mt-2 text-sm text-muted break-words">{goingLine(shown, total)}</p>
    </Section>
  );
}

const PIN = ["M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6"];

/** The location line under the date, linking down to the Location block. */
export function LocationRow({ value }: { value: string }) {
  const link = /^https?:\/\//i.test(value.trim());
  const place = link ? mapPlaceName(value) : value.trim().split("\n")[0];
  return (
    <a href="#location" className="flex items-center gap-3 group">
      <span className="w-11 h-11 shrink-0 rounded-lg border border-border bg-surface grid place-items-center text-muted"><Icon paths={PIN} /></span>
      <span className="min-w-0 text-sm">
        <span className="block font-medium truncate group-hover:text-accent">{place || "See location"}</span>
        <span className="block text-muted">{link ? "Map below" : "Address"}</span>
      </span>
    </a>
  );
}

/** Place name, an embedded map and a link out, like Luma's Location block. */
export function LocationSection({ value }: { value: string }) {
  const link = value.trim();
  const isLink = /^https?:\/\//i.test(link);
  const place = isLink ? mapPlaceName(link) : null;
  const query = mapQuery(link);
  return (
    <Section label="Location" id="location">
      {place && <p className="font-medium">{place}</p>}
      {!isLink && <p className="text-sm whitespace-pre-wrap break-words">{link}</p>}
      {query && (
        <iframe
          title={place ? `Map of ${place}` : "Event location map"}
          src={`https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mt-3 w-full h-[200px] rounded-xl border border-border bg-surface"
        />
      )}
      {isLink && <div className="mt-2"><LocationValue value={link} short /></div>}
    </Section>
  );
}

export const ICONS = {
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
  ticket: ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"],
  heart: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
  check: ["M20 6 9 17l-5-5"],
  clock: ["M12 6v6l4 2", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4"],
};

// Icon paths from Lucide (ISC license).
export function Icon({ paths, size = 20 }: { paths: string[]; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/**
 * The registration card: a header strip, one summary row (icon, what it is, price)
 * and one main action below. Luma's layout with our price on the right.
 */
export function RegisterBox({ id = "registration", head, aside, icon, title, desc, price, tone = "accent", children }: {
  id?: string;
  head: ReactNode;
  aside?: ReactNode;
  icon?: string[];
  title?: ReactNode;
  desc?: ReactNode;
  price?: ReactNode;
  tone?: "accent" | "good";
  children?: ReactNode;
}) {
  return (
    <div id={id} className="gc-reg">
      <div className="gc-reg-head"><span>{head}</span>{aside && <span className="tabular-nums">{aside}</span>}</div>
      <div className="gc-reg-body">
        {title && (
          <div className="flex items-center gap-3">
            {icon && <span className="gc-reg-icon" data-tone={tone}><Icon paths={icon} /></span>}
            <div className="min-w-0 flex-1">
              <div className="font-semibold leading-snug">{title}</div>
              {desc && <div className="text-sm text-muted">{desc}</div>}
            </div>
            {price && <div className="gc-reg-price">{price}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
