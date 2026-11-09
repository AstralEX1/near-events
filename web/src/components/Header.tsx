"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { NETWORK } from "@/lib/config";
import { Avatar, shortAccount } from "./ui";
import { SignInMenu } from "./SignIn";

/** Logo, Create, Integrate and Events links, plus the account menu. */
export function Header() {
  const { accountId, signOut } = useWallet();
  const path = usePathname() || "/";
  return <HeaderContent accountId={accountId} signOut={signOut} path={path} />;
}

/** The same header shell with a safe sample sign-in state for the Stageshow scene. */
export function HeaderPreview({ path = "/e/4", accountId = null }: { path?: string; accountId?: string | null }) {
  return <HeaderContent accountId={accountId} path={path} preview />;
}

function HeaderContent({
  accountId,
  signOut,
  path,
  preview = false,
}: {
  accountId: string | null;
  signOut?: () => void;
  path: string;
  preview?: boolean;
}) {

  return (
    <header className={`sticky top-0 z-10 backdrop-blur bg-bg/90 border-b border-border${preview ? " nm-app-header" : ""}`}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 sm:gap-4 whitespace-nowrap">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-flex w-7 h-7 rounded-lg bg-accent text-white text-[13px] font-bold items-center justify-center">
            N
          </span>
          Near Me
        </Link>
        {NETWORK === "testnet" && (
          <span className="hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent">testnet</span>
        )}
        <nav className="ml-auto flex items-center gap-1 sm:gap-2 text-sm">
          <Link href="/events" className="hidden sm:inline text-muted hover:text-text px-2">
            Events
          </Link>
          <Link
            href="/create"
            className={`px-2 py-1 rounded-lg ${path.startsWith("/create") ? "text-text font-medium" : "text-muted hover:text-text"}`}
          >
            Create
          </Link>
          <Link
            href="/widget"
            className={`px-2 py-1 rounded-lg ${path.startsWith("/widget") ? "text-text font-medium" : "text-muted hover:text-text"}`}
          >
            Integrate
          </Link>
          {accountId ? (
            <>
              <Link href="/me" className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface">
                <Avatar account={accountId} size={24} />
                <span className="hidden sm:inline max-w-40 truncate">{shortAccount(accountId)}</span>
              </Link>
              {preview ? (
                <span className="nm-signout-preview">Sign out</span>
              ) : (
                <button type="button" className="text-muted hover:text-text" onClick={signOut}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            preview ? (
              <span className="btn btn-primary !py-1.5" aria-hidden="true">Sign in</span>
            ) : (
              <SignInMenu />
            )
          )}
        </nav>
      </div>
    </header>
  );
}
