import { schemaOrgLocation, type ImportedEvent } from "./eventImport.ts";

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
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return null;
  try {
    const url = new URL(value, base);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function imageUrl(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(imageUrl).find(Boolean) ?? null;
  if (typeof value === "string") return publicUrl(value);
  const item = object(value);
  return item ? publicUrl(item.url ?? item.contentUrl) : null;
}

function metaImage(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = /\b(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(tag);
    const content = tag.match(/\bcontent=["']([^"']+)["']/i)?.[1];
    if (property && content) return publicUrl(decodeHtml(content));
  }
  return null;
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

  const organizerValue = Array.isArray(event?.organizer) ? event.organizer[0] : event?.organizer;
  const organizer = object(organizerValue);
  const hostName = typeof organizer?.name === "string" ? organizer.name.trim() : "";
  const hostUrl = publicUrl(organizer?.url);
  const details = [eventDescription(html, typeof event?.description === "string" ? event.description : "")];
  const contactValues = [organizer?.email, organizer?.telephone]
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .map((value) => value.trim());
  const sameAs = organizer?.sameAs;
  const contacts = Array.isArray(organizer?.contactPoint) ? organizer.contactPoint : [organizer?.contactPoint];
  for (const contact of contacts) {
    const point = object(contact);
    for (const value of [point?.email, point?.telephone]) {
      if (typeof value === "string" && value.trim()) contactValues.push(value.trim());
    }
    const contactUrl = publicUrl(point?.url);
    if (contactUrl) contactValues.push(contactUrl);
  }
  for (const value of Array.isArray(sameAs) ? sameAs : [sameAs]) {
    const link = publicUrl(value);
    if (link) contactValues.push(link);
  }
  if (hostName || hostUrl || contactValues.length) {
    details.push([`Hosted by ${hostName || "Event host"}`, hostUrl, ...new Set(contactValues)].filter(Boolean).join("\n"));
  }

  return {
    title,
    starts_at,
    ends_at,
    location: schemaOrgLocation(event?.location),
    description: details.filter(Boolean).join("\n\n").slice(0, 10_000),
    cover_url: imageUrl(event?.image) ?? metaImage(html),
  };
}

export async function fetchBaliSquadEvent(input: string): Promise<ImportedEvent> {
  const slug = baliSquadSlug(input);
  if (!slug) throw new Error("Paste one BaliSquad event link, like https://balisquad.com/event/example-event");
  let url = `${ORIGIN}/event/${slug}`;
  let redirects = 0;
  for (;;) {
    const response = await fetch(url, {
      headers: { accept: "text/html", "user-agent": "Nearvent/1.0" },
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
