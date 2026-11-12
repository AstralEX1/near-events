import Link from "next/link";
import { Suspense } from "react";
import { AppearancePicker } from "@/components/AppearancePicker";
import { Header } from "@/components/Header";

// The full site: header and footer. Embeds under /embed render without them.
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* Header reads the URL (usePathname), so it streams in instead of blocking prerender. */}
      <Suspense fallback={<div className="h-[76px] border-b border-border" />}>
        <Header />
      </Suspense>
      <main className="gc-main">{children}</main>
      <footer className="gc-footer">
        <div className="gc-footer-links">
          <span>Nearvent · no platform fee</span>
          <Link href="/docs">Docs</Link>
          <Link href="/demo">Demo</Link>
          <Link href="/video">Video</Link>
        </div>
        <AppearancePicker />
      </footer>
    </>
  );
}
