import { events } from "@/lib/near";
import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken } from "@/lib/staff";
import { botConfigured, readChatToken, tg, updateStore } from "@/lib/telegram";
import { esc } from "@/lib/notify";

// The confirm page calls this after the host created the event, so the bot
// knows which chat manages it. The chat token proves which chat asked; the
// staff token (Authorization: Bearer) proves the caller is the event's host.
// This link is what lets the bot check guests in. First link wins.
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!botConfigured()) return Response.json({ error: "Bot not configured" }, { status: 503 });
  let host: string | null = null;
  try {
    host = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  } catch {}
  if (!host) return Response.json({ error: "Sign in again to connect the event to Telegram" }, { status: 401 });
  const { token, eventId } = await req.json().catch(() => ({}));
  const chat = typeof token === "string" ? readChatToken(token) : null;
  const id = Number(eventId);
  if (!chat || !Number.isInteger(id)) return Response.json({ error: "Link expired. Send /new to the bot again." }, { status: 400 });
  const e = await events.get(id);
  if (!e) return Response.json({ error: "Event not found" }, { status: 404 });
  if (e.host !== host) return Response.json({ error: "Only the event host can connect it to Telegram" }, { status: 403 });
  const linked = await updateStore((s) => {
    if (s.events[id]) return s.events[id].chat === chat;
    s.events[id] = { chat, seen: [] };
    return true;
  });
  if (!linked) return Response.json({ error: "This event is already managed from another chat" }, { status: 409 });
  await tg("sendMessage", {
    chat_id: chat,
    parse_mode: "HTML",
    text: `🎉 <b>${esc(e.metadata.title)}</b> is live (#${id}). I’ll ping you on every deposit.\n\n/status shows the pool and buttons. Tap “Website button” to put it on your site.`,
  });
  return Response.json({ ok: true });
}

/** Whether the bot is set up on this server. Public. */
export function GET() {
  return Response.json({ bot: botConfigured() });
}
