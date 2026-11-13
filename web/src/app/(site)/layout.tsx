import Link from "next/link";
import { Suspense } from "react";
import { Header } from "@/components/Header";
import { EVENTS_CONTRACT, EXPLORER_URL } from "@/lib/config";

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
        {/* Unlabelled groups: product, on-chain, us. The landing footer mirrors this. */}
        <nav aria-label="Footer" className="gc-footer-links">
          <div>
            <Link href="/docs">Docs</Link>
            <Link href="/docs/website">Integrate</Link>
            <Link href="/demo">Demo</Link>
            <Link href="/video">Video</Link>
          </div>
          <div>
            <a href={`${EXPLORER_URL}/address/${EVENTS_CONTRACT}`} target="_blank" rel="noopener">Contract</a>
            <a href="https://github.com/AstralEX1/near-events" target="_blank" rel="noopener">GitHub</a>
            <a href="https://near.org/intents" target="_blank" rel="noopener">NEAR Intents</a>
          </div>
          <div>
            <Link href="/brand">Brand</Link>
            <a href="https://t.me/AstralEX163" target="_blank" rel="noopener">Contact Us</a>
          </div>
        </nav>
      </footer>
    </>
  );
}
