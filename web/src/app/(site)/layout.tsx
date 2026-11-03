import { Header } from "@/components/Header";

// The full site: header and footer. Embeds under /embed render without them.
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      <footer className="text-center text-xs text-muted py-6">
        Near Events · deposits held by a NEAR smart contract · no platform fee
      </footer>
    </>
  );
}
