import { Suspense } from "react";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>;
}
