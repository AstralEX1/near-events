import { Suspense } from "react";
import { EventSkeleton } from "@/components/ui";

// Free event pages read the id with useParams() on the client; stream them in.
export default function FreeEventLayout({ children }: LayoutProps<"/f/[id]">) {
  return <Suspense fallback={<EventSkeleton />}>{children}</Suspense>;
}
