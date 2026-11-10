"use client";

import { Avatar, shortAccount } from "./ui";
import { ReputationBadges } from "./ReputationBadges";
import { LINK_KINDS, displayName, linkUrl, type Profile } from "@/lib/profilesShared";
import type { Reputation } from "@/lib/reputationShared";

const LINK_LABEL = { x: "X", telegram: "Telegram", instagram: "Instagram", website: "Website" } as const;

/** Avatar, name with attended/hosted badges, @username and links: the top of a person's page. */
export function ProfileCard({ account, profile, reputation, showUp }: {
  account: string;
  profile: Profile | null;
  reputation: Reputation | null;
  showUp?: { came: number; of: number };
}) {
  const name = displayName(profile);
  return (
    <div className="flex items-center gap-5">
      <Avatar account={account} src={profile?.avatar_url} seed={profile?.avatar_seed} size={88} />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h1 className="text-2xl font-semibold break-words mr-1">{name ?? shortAccount(account)}</h1>
          {reputation && <ReputationBadges {...reputation} showUp={showUp} />}
        </div>
        <p className="text-sm text-muted break-all">{profile?.username && name !== `@${profile.username}` ? `@${profile.username} · ` : ""}{shortAccount(account)}</p>
        {profile && Object.keys(profile.links).length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-sm">
            {LINK_KINDS.filter((k) => profile.links[k]).map((k) => (
              <a key={k} href={linkUrl(k, profile.links[k]!)} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">{LINK_LABEL[k]}</a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
