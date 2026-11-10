import { getCover, isCoverId } from "@/lib/covers";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isCoverId(id)) return new Response("Not found", { status: 404 });
  try {
    const bytes = await getCover(id);
    if (!bytes) return new Response("Not found", { status: 404 });
    // Content-addressed by hash, so it never changes.
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
}
