import { Suspense } from "react";

// The profile reads the account with useParams() on the client; stream it in.
export default function ProfileLayout({ children }: LayoutProps<"/u/[account]">) {
  return <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>;
}
