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

/** Real events often have details longer than fit on chain, and the form would refuse them on submit. */
export function fitImportedEvent(event: ImportedEvent): { event: ImportedEvent; shortened: boolean } {
  const description = cutToBytes(event.description, MAX_DETAILS_BYTES);
  return { event: { ...event, description }, shortened: description !== event.description };
}

export function isGoogleMapsLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const inMaps = /^\/maps(\/|$)/.test(url.pathname);
    switch (url.hostname) {
      case "maps.google.com":
      case "maps.app.goo.gl":
        return true;
      case "google.com":
      case "www.google.com":
      case "goo.gl":
        return inMaps;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** Why a location can't be saved, or null if it can. Empty is fine: location is optional. */
export function locationProblem(value: string): string | null {
  const location = value.trim();
  if (!location) return null;
  if (!isGoogleMapsLink(location)) return "Location must be a Google Maps link.";
  return bytes(location) > MAX_LOCATION_BYTES ? "Map link is too long." : null;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function mapsSearchLink(query: string, placeId = ""): string {
  const place = placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}${place}`;
}

/** Google Maps link for a Luma event. Empty when the address is hidden or Luma gave nothing to link to. */
export function lumaLocation(event: Record<string, unknown>): string {
  const visibility = text(event.geo_address_visibility).toLowerCase();
  if (!["shown", "public", "visible"].includes(visibility)) return "";
  const place = record(event.geo_address_info);
  if (!place) return "";
  const point = record(event.coordinate) ?? record(place.place_coordinate);
  // Coordinates keep the link short whatever the address looks like; the place id opens the venue itself.
  const query = point && finite(point.latitude) && finite(point.longitude)
    ? `${point.latitude},${point.longitude}`
    : text(place.full_address) || text(place.address) || text(place.city_state);
  return query ? mapsSearchLink(query, text(place.place_id)) : "";
}

/** Google Maps link for a schema.org event location, which is a Place or plain text. */
export function schemaOrgLocation(location: unknown): string {
  const place = record(location);
  if (!place) return text(location) ? mapsSearchLink(text(location)) : "";
  const given = text(place.sameAs).replace(/^http:/i, "https:");
  if (isGoogleMapsLink(given)) return given;
  const geo = record(place.geo);
  if (geo && finite(geo.latitude) && finite(geo.longitude)) return mapsSearchLink(`${geo.latitude},${geo.longitude}`);
  const address = record(place.address);
  const query = [place.name, address?.streetAddress, address?.addressLocality, address?.addressRegion]
    .map(text)
    .filter((part, index, all) => part && all.indexOf(part) === index)
    .join(", ");
  return query ? mapsSearchLink(query) : "";
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
