import { rateLimited } from "@/lib/ratelimit";
import type { ImportedEvent } from "@/lib/eventImport";

// Only the public event slug is sent to Luma.

function slugOf(input: string): string | null {
  const s = input.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:lu\.ma|luma\.com)\/(?:event\/)?([A-Za-z0-9-]{3,64})\/?(?:[?#].*)?$/);
  if (m) return m[1];
  return /^(?:evt-)?[A-Za-z0-9-]{3,64}$/.test(s) ? s : null;
}

function publicUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function coverUrl(event: Record<string, unknown>): string | null {
  const value = event.cover_url ?? event.cover_image_url ?? event.cover_image;
  if (typeof value === "string") return publicUrl(value);
  if (value && typeof value === "object") {
    const image = value as Record<string, unknown>;
    return publicUrl(image.url ?? image.image_url);
  }
  return null;
}

type RichNode = {
  type?: string;
  text?: unknown;
  content?: RichNode[];
  marks?: { type?: string; attrs?: { href?: unknown } }[];
};

function descriptionOf(value: unknown): string {
  const text = (node: unknown): string => {
    if (Array.isArray(node)) return node.map(text).join("");
    if (typeof node === "string") return node.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
    if (!node || typeof node !== "object") return "";
    const item = node as RichNode;
    if (item.type === "text") {
      const value = typeof item.text === "string" ? item.text : "";
      const href = item.marks?.find((mark) => mark.type === "link")?.attrs?.href;
      const url = publicUrl(href);
      return url && !value.includes(url) ? `${value} (${url})` : value;
    }
    if (item.type === "hard_break") return "\n";
    const content = text(item.content ?? []);
    return ["paragraph", "heading", "list_item"].includes(item.type ?? "") ? `${content.trimEnd()}\n` : content;
  };
  return text(value).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function hostDetails(hosts: unknown): string[] {
  if (!Array.isArray(hosts)) return [];
  return hosts.flatMap((host) => {
    if (!host || typeof host !== "object") return [];
    const h = host as Record<string, unknown>;
    const name = typeof h.name === "string" ? h.name.trim() : "";
    const links: string[] = [];
    const website = publicUrl(h.website);
    if (website) links.push(`Website: ${website}`);
    const handleLinks = [
      ["Instagram", "instagram_handle", "https://instagram.com/"],
      ["X", "twitter_handle", "https://x.com/"],
      ["TikTok", "tiktok_handle", "https://www.tiktok.com/@"],
      ["YouTube", "youtube_handle", "https://www.youtube.com/@"],
    ] as const;
    for (const [label, key, prefix] of handleLinks) {
      const handle = typeof h[key] === "string" ? (h[key] as string).replace(/^@/, "") : "";
      if (/^[A-Za-z0-9._-]+$/.test(handle)) links.push(`${label}: ${prefix}${handle}`);
    }
    const linkedin = typeof h.linkedin_handle === "string" ? h.linkedin_handle : "";
    if (/^\/(?:in|company)\/[A-Za-z0-9-]+\/?$/.test(linkedin)) links.push(`LinkedIn: https://www.linkedin.com${linkedin}`);
    return name || links.length ? [`Hosted by ${name || "Luma host"}${links.length ? `\n${links.join("\n")}` : ""}`] : [];
  });
}

function locationOf(event: Record<string, unknown>): string {
  const visibility = String(event.geo_address_visibility ?? event.location_visibility ?? "").toLowerCase();
  // Luma defaults location_visibility to public; do not expose details it marks guests-only.
  if (visibility && !["shown", "public", "visible"].includes(visibility)) return "";
  const geo = event.geo_address_info ?? event.geo_address_json;
  if (!geo || typeof geo !== "object") return "";
  const place = geo as Record<string, unknown>;
  const address = [place.full_address, place.address, place.city_state]
    .find((value) => typeof value === "string" && value.trim());
  const coordinate = event.coordinate;
  const point = coordinate && typeof coordinate === "object" ? coordinate as Record<string, unknown> : null;
  const textQuery = [address, place.name].find((value) => typeof value === "string" && value.trim());
  const query = typeof textQuery === "string" ? textQuery.trim()
    : typeof point?.latitude === "number" && typeof point.longitude === "number" ? `${point.latitude},${point.longitude}` : "";
  const placeId = typeof place.place_id === "string" && place.place_id.trim() ? place.place_id : "";
  const mapQuery = query || (placeId ? `place_id:${placeId}` : "");
  const map = mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ""}`
    : "";
  return [typeof address === "string" ? address.trim() : "", map ? `Map: ${map}` : ""].filter(Boolean).join("\n");
}

export async function GET(req: Request) {
  if (rateLimited(req, 20)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const slug = slugOf(new URL(req.url).searchParams.get("url") ?? "");
  if (!slug) return Response.json({ error: "Paste a link like https://lu.ma/your-event" }, { status: 400 });

  const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json", "user-agent": "NearMe/1.0" },
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return Response.json({ error: "Couldn’t read that Luma event. Is it public?" }, { status: 404 });
  const json = await res.json().catch(() => null);
  const d = json?.data;
  const e = d?.event;
  if (json?.kind !== "event" || !e?.name) return Response.json({ error: "That link isn’t a Luma event" }, { status: 404 });

  const starts_at = Date.parse(e.start_at);
  const ends_at = Date.parse(e.end_at ?? e.start_at);
  if (!Number.isFinite(starts_at) || !Number.isFinite(ends_at)) {
    return Response.json({ error: "Couldn’t read that Luma event’s dates" }, { status: 404 });
  }
  const imported: ImportedEvent = {
    title: String(e.name).slice(0, 120),
    starts_at,
    ends_at,
    location: locationOf(e).slice(0, 1000),
    description: [descriptionOf(d.description_mirror), ...hostDetails(d.hosts)].filter(Boolean).join("\n\n").slice(0, 10_000),
    cover_url: coverUrl(e),
  };
  return Response.json(imported);
}
