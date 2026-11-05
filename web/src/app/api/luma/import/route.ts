import { rateLimited } from "@/lib/ratelimit";

// Turns a public Luma event link into our event draft (title, time, place,
// cover, description), so a host on Luma can move registration to us in one
// paste. Reads Luma's public page data; no key needed. Only the slug is sent
// to Luma, so this can't be pointed at other servers.

interface Mirror {
  type?: string;
  text?: string;
  content?: Mirror[];
}

/** Luma stores descriptions as a ProseMirror tree; we keep plain text. */
function plain(node: Mirror | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hard_break") return "\n";
  const inner = (node.content ?? []).map(plain).join("");
  return ["paragraph", "heading", "list_item", "blockquote"].includes(node.type ?? "") ? `${inner}\n` : inner;
}

function slugOf(input: string): string | null {
  const s = input.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:lu\.ma|luma\.com)\/(?:event\/)?([A-Za-z0-9-]{3,64})\/?(?:[?#].*)?$/);
  if (m) return m[1];
  return /^(?:evt-)?[A-Za-z0-9-]{3,64}$/.test(s) ? s : null;
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

  const geo = e.geo_address_info ?? {};
  const location =
    e.location_type === "online" ? "Online" : geo.full_address ?? [geo.address, geo.city].filter(Boolean).join(", ") ?? "";
  return Response.json({
    title: String(e.name).slice(0, 120),
    starts_at: Date.parse(e.start_at),
    ends_at: Date.parse(e.end_at ?? e.start_at),
    timezone: e.timezone ?? null,
    location: String(location).slice(0, 300),
    cover_url: typeof e.cover_url === "string" && e.cover_url.length <= 300 ? e.cover_url : null,
    description: plain(d.description_mirror).replace(/\n{3,}/g, "\n\n").trim().slice(0, 2000),
    hosts: (d.hosts ?? []).map((h: { name?: string }) => h.name).filter(Boolean).slice(0, 5),
    luma_url: `https://lu.ma/${e.url ?? slug}`,
  });
}
