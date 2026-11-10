import { detectEventSource } from "./eventImport.ts";
import type { EventMode } from "./near";

// Where each step of the Create and Integrate flows lives. See createStep for the rules.

/** How guests join: a deposit or a ticket on chain, or Free (our server only, see freeEventsShared.ts). */
export type JoinMode = EventMode | "Free";

export interface Choice {
  mode: JoinMode;
  amount: string;
  /** The Luma or BaliSquad link, in the Integrate flow only. */
  link?: string;
}

interface Params {
  get(name: string): string | null;
  has(name: string): boolean;
}

export function parseMode(value: string | null | undefined): JoinMode | null {
  return value === "Deposit" || value === "Ticket" || value === "Free" ? value : null;
}

/** At least 0.1 USDC, which has 6 decimals. */
export function validAmount(value: string | null | undefined): boolean {
  return !!value && /^(\d+\.?\d{0,6}|\.\d{1,6})$/.test(value) && Number(value) >= 0.1;
}

/** Which screen /create shows. `from` (Duplicate event) has always opened the form directly. */
export function createStep(params: Params): "form" | "start-create" | "start-widget" {
  if (params.has("from")) return "form";
  const mode = parseMode(params.get("mode"));
  const chosen = mode === "Free" || (!!mode && validAmount(params.get("amount")));
  if (params.get("flow") === "widget") {
    // The site button takes payment, so Integrate never opens a free event.
    return chosen && mode !== "Free" && params.get("step") !== "start" && detectEventSource(params.get("import") ?? "") ? "form" : "start-widget";
  }
  return chosen && params.get("step") !== "start" ? "form" : "start-create";
}

const query = (entries: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(entries).filter((entry): entry is [string, string] => !!entry[1])).toString();

/** The detailed form for this choice. */
export function formUrl({ mode, amount, link }: Choice): string {
  return `/create?${query(link ? { flow: "widget", mode, amount, import: link } : { mode, amount })}`;
}

/** The start step with this choice filled in, for Back and for fixing a link that failed to import. */
export function startUrl({ mode, amount, link }: Partial<Choice>, widget: boolean): string {
  const filled = query({ mode, amount, import: link });
  const base = widget ? "/create?flow=widget&step=start" : "/create?step=start";
  return filled ? `${base}&${filled}` : base;
}

export const integrationUrl = (eventId: number | string) => `/e/${eventId}/manage?tab=integration`;
