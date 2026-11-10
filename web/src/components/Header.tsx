"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { Avatar } from "./ui";
import { SignInMenu } from "./SignIn";
import { Icon } from "./EventSections";

// Lucide paths (ISC).
const COMPASS = ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"];
const TICKET = ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"];
const CALENDAR_PLUS = ["M8 2v4", "M16 2v4", "M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8", "M3 10h18", "M16 19h6", "M19 16v6"];
const USER = ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8"];
const HELP = ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"];

function NavLabel({ icon, label }: { icon: string[]; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><Icon paths={icon} size={16} />{label}</span>;
}

export function Header() {
  const { accountId, signOut } = useWallet();
  const path = usePathname() || "/";
  return <HeaderContent accountId={accountId} signOut={signOut} path={path} />;
}

export function HeaderPreview({ path = "/e/4", accountId = null }: { path?: string; accountId?: string | null }) {
  return <HeaderContent accountId={accountId} path={path} preview />;
}

function HeaderContent({ accountId, signOut, path, preview = false }: {
  accountId: string | null; signOut?: () => void; path: string; preview?: boolean;
}) {
  const links: [string, string, string[]][] = [["/events", "Explore", COMPASS], ["/me", "My Events", TICKET], ["/create", "Create Event", CALENDAR_PLUS]];
  return (
    <header className="gc-header">
      <div className="gc-header-inner">
        <Link href="/" className="gc-brand" aria-label="Nearvent home">nearvent</Link>
        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1 ml-auto">
          {links.map(([href, label, icon]) => <Link key={href} href={href} className="gc-nav-link" aria-current={path.startsWith(href) ? "page" : undefined}><NavLabel icon={icon} label={label} /></Link>)}
        </nav>
        <details key={`menu:${path}`} className="gc-account sm:hidden ml-auto" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
          <summary>Menu</summary>
          <nav aria-label="Mobile navigation" className="gc-account-panel">
            {links.map(([href, label, icon]) => <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}><NavLabel icon={icon} label={label} /></Link>)}
            {accountId && <Link href="/profile"><NavLabel icon={USER} label="My Profile" /></Link>}
            <Link href="/docs"><NavLabel icon={HELP} label="Docs" /></Link>
          </nav>
        </details>
        {accountId ? (
          <details key={`account:${path}`} className="gc-account" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
            <summary aria-label="Your account"><Avatar account={accountId} size={26} /><span className="hidden md:inline">My Profile</span></summary>
            <div className="gc-account-panel">
              <Link href="/profile"><NavLabel icon={USER} label="My Profile" /></Link>
              {!preview && <button type="button" onClick={signOut}>Sign Out</button>}
            </div>
          </details>
        ) : preview ? <span className="btn btn-primary">Sign In</span> : <SignInMenu />}
      </div>
    </header>
  );
}
