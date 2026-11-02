import { oneClick } from "@/lib/oneclick";

// Thin proxy so the browser never sees the API key. Only the endpoints we use.
const ALLOWED = new Set(["tokens", "quote", "status", "deposit/submit"]);

async function handle(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = (await params).path.join("/");
  if (!ALLOWED.has(path)) return Response.json({ error: "Not allowed" }, { status: 404 });
  const search = new URL(req.url).search;
  try {
    const res = await oneClick(`/v0/${path}${search}`, {
      method: req.method,
      body: req.method === "POST" ? await req.text() : undefined,
    });
    const text = await res.text();
    if (!res.headers.get("content-type")?.includes("json")) {
      return Response.json({ error: `1Click is unavailable right now (HTTP ${res.status})` }, { status: 502 });
    }
    return new Response(text, { status: res.status, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return Response.json({ error: `1Click unreachable: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}

export { handle as GET, handle as POST };
