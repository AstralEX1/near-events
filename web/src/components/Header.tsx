"use client";

import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { NETWORK } from "@/lib/config";
import { Avatar, shortAccount } from "./ui";
import { SignInMenu } from "./SignIn";

export function Header() {
  const { accountId, signOut } = useWallet();
  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-bg/80 border-b border-border">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded-lg bg-gradient-to-br from-accent to-pink-400" />
          Near Events
        </Link>
        {NETWORK === "testnet" && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent">testnet</span>
        )}
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <Link href="/#events" className="hidden md:inline text-muted hover:text-text px-2">Events</Link>
          <Link href="/guide" className="hidden md:inline text-muted hover:text-text px-2">Guide</Link>
          <Link href="/widget" className="hidden sm:inline text-muted hover:text-text px-2">For your website</Link>
          <Link href="/create" className="btn btn-ghost !py-1.5">Create event</Link>
          {accountId ? (
            <>
              <Link href="/me" className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface">
                <Avatar account={accountId} size={24} />
                <span className="hidden sm:inline max-w-40 truncate">{shortAccount(accountId)}</span>
              </Link>
              <button className="text-muted hover:text-text" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <SignInMenu />
          )}
        </nav>
      </div>
    </header>
  );
}
