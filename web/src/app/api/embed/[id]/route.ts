import { events, formatUsdc } from "@/lib/near";

// Public event summary for /embed.js buttons on other sites. Read-only, so any origin may call it.
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=15" };

export async function GET(_req: Request, ctx: RouteContext<"/api/embed/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id < 0) return Response.json({ error: "Bad event id" }, { status: 400, headers: CORS });
  const e = await events.get(id).catch(() => null);
  if (!e) return Response.json({ error: "Event not found" }, { status: 404, headers: CORS });
  return Response.json(
    {
      id: e.id,
      title: e.metadata.title,
      starts_at: e.metadata.starts_at,
      ends_at: e.metadata.ends_at,
      location: e.metadata.location,
      status: e.status,
      deposit_usdc: formatUsdc(e.deposit),
      mode: e.mode ?? "Deposit",
      going: e.guest_count,
      capacity: e.capacity,
      full: e.guest_count >= e.capacity,
    },
    { headers: CORS },
  );
}
