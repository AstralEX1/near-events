"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { NETWORK } from "@/lib/config";
import { Avatar, shortAccount } from "./ui";
import { SignInMenu } from "./SignIn";

/** Logo, Create and Events links, plus the account menu. */
export function Header() {
  const { accountId, signOut } = useWallet();
  const path = usePathname() || "/";

  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-bg/90 border-b border-border">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-flex w-7 h-7 rounded-lg bg-accent text-white text-[13px] font-bold items-center justify-center">
            N
          </span>
          Near Me
        </Link>
        {NETWORK === "testnet" && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent">testnet</span>
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
          {accountId ? (
            <>
              <Link href="/me" className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface">
                <Avatar account={accountId} size={24} />
                <span className="hidden sm:inline max-w-40 truncate">{shortAccount(accountId)}</span>
              </Link>
              <button type="button" className="text-muted hover:text-text" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <SignInMenu />
          )}
        </nav>
      </div>
    </header>
  );
}
