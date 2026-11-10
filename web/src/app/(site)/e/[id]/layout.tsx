import { Suspense } from "react";
import { EventSkeleton } from "@/components/ui";

// Event pages read the id with useParams() on the client; stream them in.
export default function EventLayout({ children }: LayoutProps<"/e/[id]">) {
  return <Suspense fallback={<EventSkeleton />}>{children}</Suspense>;
}
