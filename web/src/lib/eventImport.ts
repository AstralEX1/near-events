export interface ImportedEvent {
  title: string;
  starts_at: number;
  ends_at: number;
  location: string;
  description: string;
}

// The escrow's limits for public text, in UTF-8 bytes (contracts/events: MAX_SHORT_LEN, MAX_TEXT_LEN).
const MAX_LOCATION_BYTES = 300;
const MAX_DETAILS_BYTES = 2000;

const bytes = (s: string) => new TextEncoder().encode(s).length;

function cutToBytes(text: string, limit: number): string {
  if (bytes(text) <= limit) return text;
  let out = "";
  for (const char of text) {
    if (bytes(out + char) > limit - bytes("…")) break;
    out += char;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Real events often exceed what fits on chain, and the form would refuse them on submit.
 * A long location loses its map link first, since the address matters more.
 */
export function fitImportedEvent(event: ImportedEvent): { event: ImportedEvent; shortened: boolean } {
  const withoutMap = event.location.replace(/\n?Map: \S+$/, "");
  const location = bytes(event.location) <= MAX_LOCATION_BYTES ? event.location : cutToBytes(withoutMap, MAX_LOCATION_BYTES);
  const description = cutToBytes(event.description, MAX_DETAILS_BYTES);
  return {
    event: { ...event, location, description },
    shortened: location !== event.location || description !== event.description,
  };
}

export type EventSource = "Luma" | "BaliSquad";

export const IMPORT_ENDPOINT: Record<EventSource, string> = {
  Luma: "/api/luma/import",
  BaliSquad: "/api/balisquad/import",
};

const SOURCE_BY_HOST: Record<string, EventSource> = {
  "lu.ma": "Luma",
  "luma.com": "Luma",
  "balisquad.com": "BaliSquad",
};

/** Which site an event link is from, or null if we can't import from it. The link may omit https://. */
export function detectEventSource(input: string): EventSource | null {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || url.pathname.length < 2) return null;
    return SOURCE_BY_HOST[url.hostname.replace(/^www\./, "")] ?? null;
  } catch {
    return null;
  }
}
