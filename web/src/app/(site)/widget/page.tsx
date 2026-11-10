import { redirect } from "next/navigation";
import { integrationUrl, startUrl } from "@/lib/flow";

type Param = string | string[] | undefined;
const one = (value: Param) => (typeof value === "string" ? value : undefined);

/** Old Integrate entry: /create with "Integrate instead?" on. /widget?event=<id> opens that event's guide. */
export default async function WidgetPage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const params = await searchParams;
  const event = one(params.event);
  if (event && /^(0|[1-9]\d*)$/.test(event) && Number.isSafeInteger(Number(event))) redirect(integrationUrl(event));
  redirect(startUrl({ mode: one(params.mode) as never, amount: one(params.amount), link: one(params.import) }, true));
}
