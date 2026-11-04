import Link from "next/link";
import { Header } from "@/components/Header";

// The full site: header and footer. Embeds under /embed render without them.
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      <footer className="text-center text-xs text-muted py-8 space-x-3">
        <span>Near Events · no platform fee</span>
        <Link href="/try" className="hover:text-text">Try</Link>
        <Link href="/guide" className="hover:text-text">How it works</Link>
        <Link href="/widget" className="hover:text-text">For your website</Link>
      </footer>
    </>
  );
}
