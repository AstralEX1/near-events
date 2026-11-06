import type { ImportedEvent } from "./eventImport";

const ORIGIN = "https://balisquad.com";
const HOSTS = new Set(["balisquad.com", "www.balisquad.com"]);
type JsonObject = Record<string, unknown>;

export function baliSquadSlug(input: string): string | null {
  try {
    const value = input.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(url.protocol) || !HOSTS.has(url.hostname) || url.port || url.username || url.password) return null;
    return url.pathname.match(/^\/(?:id\/)?event\/([A-Za-z0-9_-]{3,100})\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function findEvent(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const event = findEvent(item);
      if (event) return event;
    }
    return null;
  }
  const item = object(value);
  if (!item) return null;
  const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
  if (types.some((type) => typeof type === "string" && type.split("/").pop()?.toLowerCase() === "event")) return item;
  for (const child of Object.values(item)) {
    const event = findEvent(child);
    if (event) return event;
  }
  return null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code: string) => {
      const point = Number.parseInt(code.slice(code[0].toLowerCase() === "x" ? 1 : 0), code[0].toLowerCase() === "x" ? 16 : 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : "";
    });
}

function plainText(value: string): string {
  return decodeHtml(value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|ul|ol)\s*>/gi, "\n")
    .replace(/<(?:p|div|li|h[1-6]|blockquote|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function publicUrl(value: unknown, base = ORIGIN): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function instant(value: unknown): number {
  if (typeof value !== "string") return NaN;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return NaN;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", fraction = "", sourceZone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  if (month < 1 || month > 12 || day < 1 || day > lastDay.getUTCDate() || hour > 23 || minute > 59 || second > 59) return NaN;
  const zone = sourceZone?.toLowerCase() === "z" ? "Z" : sourceZone ?? "+08:00";
  const offset = zone.match(/^[+-](\d{2}):?(\d{2})$/);
  if (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59)) return NaN;
  return Date.parse(`${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}${secondText === "00" && !match[6] ? "" : `:${secondText}${fraction}`}${zone}`);
}

// shortcut: BaliSquad's public HTML is the only source, replace this parser if they publish an import API.
function eventDescription(html: string, fallback: string): string {
  const opening = /<div\b[^>]*class=["'][^"']*\bevent-description\b[^"']*["'][^>]*>/i.exec(html);
  let block: string | undefined;
  if (opening?.index !== undefined) {
    const bodyStart = opening.index + opening[0].length;
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = bodyStart;
    let depth = 1;
    for (const tag of html.matchAll(tags)) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (!depth) {
        block = html.slice(bodyStart, tag.index);
        break;
      }
    }
  }
  if (!block) return plainText(fallback);
  const description = plainText(block);
  const links = [...block.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => {
      const href = publicUrl(decodeHtml(match[1]));
      const label = plainText(match[2]);
      return href && !description.includes(href) ? `${label && label !== href ? `${label}: ` : ""}${href}` : "";
    })
    .filter(Boolean);
  return [description, links.length ? `Links:\n${[...new Set(links)].join("\n")}` : ""].filter(Boolean).join("\n\n");
}

function mapLink(place: JsonObject): string | null {
  const url = publicUrl(place.sameAs);
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname === "maps.google.com" || parsed.hostname === "maps.app.goo.gl" || (["google.com", "www.google.com"].includes(parsed.hostname) && parsed.pathname.startsWith("/maps"))) return url;
  }
  const geo = object(place.geo);
  const latitude = geo?.latitude;
  const longitude = geo?.longitude;
  if (typeof latitude === "number" && Number.isFinite(latitude) && typeof longitude === "number" && Number.isFinite(longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  }
  return null;
}

export function parseBaliSquadEvent(html: string, expectedSlug?: string): ImportedEvent | null {
  const scripts = html.matchAll(/<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi);
  let event: JsonObject | null = null;
  for (const match of scripts) {
    try {
      event = findEvent(JSON.parse(match[1]));
      if (event) break;
    } catch {
      // Ignore unrelated or malformed structured data blocks.
    }
  }
  const sourceUrl = publicUrl(event?.url);
  if (!sourceUrl) return null;
  const source = new URL(sourceUrl);
  const sourcePath = source.pathname.match(/^\/(?:id\/)?event\/([A-Za-z0-9_-]{3,100})\/?$/);
  if (!HOSTS.has(source.hostname) || !sourcePath || (expectedSlug && sourcePath[1] !== expectedSlug)) return null;
  const title = typeof event?.name === "string" ? event.name.trim() : "";
  const starts_at = instant(event?.startDate);
  const ends_at = instant(event?.endDate);
  if (!title || !Number.isFinite(starts_at) || !Number.isFinite(ends_at) || ends_at <= starts_at) return null;

  const place = object(event?.location);
  const address = object(place?.address);
  const location = [typeof event?.location === "string" ? event.location : "", place?.name, address?.streetAddress, address?.addressLocality, address?.addressRegion]
    .filter((part): part is string => typeof part === "string" && !!part.trim())
    .map((part) => part.trim())
    .filter((part, index, all) => all.indexOf(part) === index);
  const map = place ? mapLink(place) : null;
  if (map) location.push(`Map: ${map}`);

  const organizer = object(event?.organizer);
  const hostName = typeof organizer?.name === "string" ? organizer.name.trim() : "";
  const hostUrl = publicUrl(organizer?.url);
  const details = [eventDescription(html, typeof event?.description === "string" ? event.description : "")];
  if (hostName) details.push(`Hosted by ${hostName}${hostUrl ? `\n${hostUrl}` : ""}`);

  return {
    title,
    starts_at,
    ends_at,
    location: location.join("\n"),
    description: details.filter(Boolean).join("\n\n"),
  };
}

export async function fetchBaliSquadEvent(input: string): Promise<ImportedEvent> {
  const slug = baliSquadSlug(input);
  if (!slug) throw new Error("Paste one BaliSquad event link, like https://balisquad.com/event/example-event");
  let url = `${ORIGIN}/event/${slug}`;
  let redirects = 0;
  for (;;) {
    const response = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "NearMe/1.0" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (!response) throw new Error("Couldn’t read that BaliSquad event. Is it public?");
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects++ >= 3) throw new Error("BaliSquad redirected too many times");
      const target = new URL(location, url);
      if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.port || target.username || target.password) {
        throw new Error("BaliSquad redirected outside its public site");
      }
      url = target.href;
      continue;
    }
    if (!response.ok) throw new Error("Couldn’t read that BaliSquad event. Is it public?");
    const event = parseBaliSquadEvent(await response.text().catch(() => ""), slug);
    if (!event) throw new Error("That BaliSquad page is not a readable event");
    return event;
  }
}
