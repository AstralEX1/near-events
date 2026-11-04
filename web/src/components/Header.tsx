"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/lib/wallet";
import { NETWORK } from "@/lib/config";
import { Avatar, shortAccount } from "./ui";
import { SignInMenu } from "./SignIn";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/** On marketing pages: Luma-lean — logo + Create (+ Sign in only when needed). */
export function Header() {
  const { accountId, signOut } = useWallet();
  const path = usePathname() || "/";
  const marketing = path === "/" || path === "/try";
  const hostHref = BOT && marketing ? `https://t.me/${BOT}` : "/create";

  return (
    <header className="sticky top-0 z-10 backdrop-blur bg-bg/90 border-b border-border">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded-lg bg-gradient-to-br from-accent to-pink-400" />
          Near Events
        </Link>
        {NETWORK === "testnet" && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent-soft text-accent">testnet</span>
        )}
        <nav className="ml-auto flex items-center gap-2 text-sm">
          {!marketing && (
            <Link href="/events" className="hidden sm:inline text-muted hover:text-text px-2">
              Events
            </Link>
          )}
          {marketing ? (
            <a href={hostHref} className="btn btn-primary !rounded-full !py-1.5 !px-4 !text-sm">
              Create Event
            </a>
          ) : (
            <Link href="/create" className="text-muted hover:text-text px-2">
              Host an event
            </Link>
          )}
          {accountId ? (
            <>
              <Link href="/me" className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-surface">
                <Avatar account={accountId} size={24} />
                <span className="hidden sm:inline max-w-40 truncate">{shortAccount(accountId)}</span>
              </Link>
              <button className="text-muted hover:text-text" onClick={signOut}>
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
