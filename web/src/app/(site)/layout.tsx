import Link from "next/link";
import { Suspense } from "react";
import { Header } from "@/components/Header";

// The full site: header and footer. Embeds under /embed render without them.
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Header reads the URL (usePathname), so it streams in instead of blocking prerender. */}
      <Suspense fallback={<div className="h-[57px] border-b border-border" />}>
        <Header />
      </Suspense>
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      <footer className="text-center text-xs text-muted py-8 space-x-3">
        <span>Near Me · no fee</span>
        <Link href="/guide" className="hover:text-text">How it works</Link>
        <Link href="/events" className="hover:text-text">Events</Link>
        <Link href="/create" className="hover:text-text">Create event</Link>
        <Link href="/widget" className="hover:text-text">Integrate</Link>
      </footer>
    </>
  );
}
