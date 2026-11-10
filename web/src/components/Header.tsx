"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { Avatar } from "./ui";
import { SignInMenu } from "./SignIn";

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
  const links = [["/events", "Events"], ["/me", "My events"], ["/create", "Create event"]];
  return (
    <header className="gc-header">
      <div className="gc-header-inner">
        <Link href="/" className="gc-brand" aria-label="Nearvent home">near<em>vent</em></Link>
        <nav aria-label="Main navigation" className="hidden sm:flex items-center gap-1 ml-auto">
          {links.map(([href, label]) => <Link key={href} href={href} className="gc-nav-link" aria-current={path.startsWith(href) ? "page" : undefined}>{label}</Link>)}
        </nav>
        <details key={`menu:${path}`} className="gc-account sm:hidden ml-auto" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
          <summary>Menu</summary>
          <nav aria-label="Mobile navigation" className="gc-account-panel">
            {links.map(([href, label]) => <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>{label}</Link>)}
            {accountId && <Link href="/profile">My profile</Link>}
            <Link href="/guide">How it works</Link>
          </nav>
        </details>
        {accountId ? (
          <details key={`account:${path}`} className="gc-account" onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
            <summary aria-label="Your account"><Avatar account={accountId} size={26} /><span className="hidden md:inline">My profile</span></summary>
            <div className="gc-account-panel">
              <Link href="/profile">My profile</Link>
              {!preview && <button type="button" onClick={signOut}>Sign out</button>}
            </div>
          </details>
        ) : preview ? <span className="btn btn-primary">Sign in</span> : <SignInMenu />}
      </div>
    </header>
  );
}
