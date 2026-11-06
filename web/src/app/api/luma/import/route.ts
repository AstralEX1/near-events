import { rateLimited } from "@/lib/ratelimit";

// Imports only the title and times from Luma. Only the slug is sent to Luma.

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

  return Response.json({
    title: String(e.name).slice(0, 120),
    starts_at: Date.parse(e.start_at),
    ends_at: Date.parse(e.end_at ?? e.start_at),
  });
}
