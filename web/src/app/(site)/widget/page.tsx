import { redirect } from "next/navigation";

type LegacyWidgetPageProps = {
  searchParams: Promise<{ event?: string | string[] }>;
};

/** Keep old builder links working while moving hosts into the event flow. */
export default async function LegacyWidgetPage({ searchParams }: LegacyWidgetPageProps) {
  const { event } = await searchParams;
  const eventId = typeof event === "string" && /^(0|[1-9]\d*)$/.test(event) && Number.isSafeInteger(Number(event))
    ? Number(event)
    : null;

  redirect(eventId !== null ? `/e/${eventId}/manage?tab=registration` : "/create");
}
