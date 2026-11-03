import { Suspense } from "react";

// Event pages read the id with useParams() on the client; stream them in.
export default function EventLayout({ children }: LayoutProps<"/e/[id]">) {
  return <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>;
}
