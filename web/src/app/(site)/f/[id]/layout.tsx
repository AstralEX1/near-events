import { Suspense } from "react";

// Free event pages read the id with useParams() on the client; stream them in.
export default function FreeEventLayout({ children }: LayoutProps<"/f/[id]">) {
  return <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>;
}
