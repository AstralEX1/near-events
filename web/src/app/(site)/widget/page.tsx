import { redirect } from "next/navigation";
import { StartStep } from "@/components/StartStep";
import { integrationUrl } from "@/lib/flow";

type Param = string | string[] | undefined;
const one = (value: Param) => (typeof value === "string" ? value : null);

/** The Integrate flow starts here. /widget?event=<id> opens that event's guide. */
export default async function WidgetPage({ searchParams }: { searchParams: Promise<Record<string, Param>> }) {
  const params = await searchParams;
  const event = one(params.event);
  if (event && /^(0|[1-9]\d*)$/.test(event) && Number.isSafeInteger(Number(event))) redirect(integrationUrl(event));
  return <StartStep widget initial={{ mode: one(params.mode), amount: one(params.amount), link: one(params.import) }} />;
}
