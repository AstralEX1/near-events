import { rateLimited } from "@/lib/ratelimit";
import { lumaLocation, type ImportedEvent } from "@/lib/eventImport";

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

export async function GET(req: Request) {
  if (rateLimited(req, 20)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const slug = slugOf(new URL(req.url).searchParams.get("url") ?? "");
  if (!slug) return Response.json({ error: "Paste a link like https://lu.ma/your-event" }, { status: 400 });

  const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
    headers: { accept: "application/json", "user-agent": "Nearvent/1.0" },
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
    location: lumaLocation(e),
    description: [descriptionOf(d.description_mirror), ...hostDetails(d.hosts)].filter(Boolean).join("\n\n").slice(0, 10_000),
    cover_url: coverUrl(e),
  };
  return Response.json(imported);
}
