import type { Metadata } from "next";
import { DocsNav } from "./DocsNav";

export const metadata: Metadata = {
  title: "Docs · Nearvent",
  description: "How Nearvent works: deposits for events, check-in at the door, payouts, and the smart contract behind it.",
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <DocsNav />
      <div className="min-w-0 max-w-3xl flex-1">{children}</div>
    </div>
  );
}
