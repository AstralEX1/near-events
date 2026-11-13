"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useWallet } from "@/lib/wallet";
import { Avatar } from "./ui";
import { SignInMenu } from "./SignIn";
import { Icon } from "./EventSections";
import { Logo } from "./Logo";
import { AppearancePicker } from "./AppearancePicker";

// Lucide paths (ISC).
const COMPASS = ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20", "m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"];
const TICKET = ["M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z", "M13 5v2", "M13 17v2", "M13 11v2"];
const CALENDAR_PLUS = ["M8 2v4", "M16 2v4", "M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8", "M3 10h18", "M16 19h6", "M19 16v6"];
const FLASK = ["M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2", "M6.453 15h11.094", "M8.5 2h7"];
const LOG_OUT = ["m16 17 5-5-5-5", "M21 12H9", "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"];
const USER = ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2", "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8"];

function NavLabel({ icon, label }: { icon: string[]; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><Icon paths={icon} size={16} />{label}</span>;
}

export function Header() {
  const { accountId, kind, signOut } = useWallet();
  const path = usePathname() || "/";
  return <HeaderContent accountId={accountId} signOut={signOut} path={path} demo={kind === "demo"} />;
}

export function HeaderPreview({ path = "/e/4", accountId = null }: { path?: string; accountId?: string | null }) {
  return <HeaderContent accountId={accountId} path={path} preview />;
}

function HeaderContent({ accountId, signOut, path, preview = false, demo = false }: {
  accountId: string | null; signOut?: () => void; path: string; preview?: boolean; demo?: boolean;
}) {
  const account = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // A tap anywhere else closes the account menu, like any native popover.
    const close = (e: PointerEvent) => { const d = account.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const links: [string, string, string[]][] = [["/events", "Explore", COMPASS], ["/me", "My Events", TICKET], ["/create", "Create Event", CALENDAR_PLUS]];
  if (!demo) links.push(["/demo", "Demo", FLASK]); // inside the demo its place goes to Exit Demo
  return (
    <>
    <header className="gc-header">
      <div className="gc-header-inner">
        <Link href="/about" className="gc-brand" aria-label="About Nearvent"><Logo /></Link>
        {demo && <span className="gc-demo" data-tooltip="Made-up events and money, kept in this browser. Nothing is sent anywhere.">Demo</span>}
        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1 ml-auto">
          {/* Below lg the four labels push Sign In off screen, so the tabs show icons only. */}
          {links.map(([href, label, icon]) => (
            <Link key={href} href={href} className="gc-nav-link" aria-label={label} aria-current={path.startsWith(href) ? "page" : undefined}>
              <span className="inline-flex items-center gap-1.5"><Icon paths={icon} size={16} /><span className="hidden lg:inline">{label}</span></span>
            </Link>
          ))}
          {demo && (
            <button type="button" onClick={signOut} className="gc-nav-link" aria-label="Exit Demo">
              <span className="inline-flex items-center gap-1.5"><Icon paths={LOG_OUT} size={16} /><span className="hidden lg:inline">Exit Demo</span></span>
            </button>
          )}
        </nav>
        {/* On phones the nav moves to the tab bar, so the theme button takes the push to the right. */}
        <div className="ml-auto sm:ml-0"><AppearancePicker /></div>
        {accountId ? (
          <details ref={account} key={`account:${path}`} className="gc-account" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
            <summary aria-label="Your account"><Avatar account={accountId} size={26} /><span className="hidden md:inline">My Profile</span></summary>
            <div className="gc-account-panel">
              <Link href="/profile"><NavLabel icon={USER} label="My Profile" /></Link>
              {!preview && <button type="button" onClick={signOut}>{demo ? "Exit Demo" : "Sign Out"}</button>}
            </div>
          </details>
        ) : preview ? <span className="btn btn-primary">Sign In</span> : <SignInMenu />}
      </div>
    </header>
    {/* Phones: the same places as a bottom tab bar, within thumb reach. Outside the header,
        whose backdrop-filter would otherwise pin a fixed child to the header box. */}
    {!preview && (
      <nav aria-label="Main navigation" className="gc-tabbar">
        {links.map(([href, label, icon]) => (
          <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
            <Icon paths={icon} size={22} /><span>{label}</span>
          </Link>
        ))}
        {demo && <button type="button" onClick={signOut}><Icon paths={LOG_OUT} size={22} /><span>Exit Demo</span></button>}
      </nav>
    )}
    </>
  );
}
