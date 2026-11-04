import { events } from "@/lib/near";
import { rateLimited } from "@/lib/ratelimit";
import { botConfigured, readChatToken, tg, updateStore } from "@/lib/telegram";
import { esc } from "@/lib/notify";

// The confirm page calls this after the host created the event, so the bot
// knows which chat manages it. The token proves which chat asked; the chain
// proves the bot was made co-host. First link wins.
export async function POST(req: Request) {
  if (rateLimited(req, 10)) return Response.json({ error: "Too many requests" }, { status: 429 });
  if (!botConfigured()) return Response.json({ error: "Bot not configured" }, { status: 503 });
  const { token, eventId } = await req.json().catch(() => ({}));
  const chat = typeof token === "string" ? readChatToken(token) : null;
  const id = Number(eventId);
  if (!chat || !Number.isInteger(id)) return Response.json({ error: "Link expired. Send /new to the bot again." }, { status: 400 });
  const e = await events.get(id);
  const bot = process.env.RELAYER_ACCOUNT_ID;
  if (!e || !bot || !e.cohosts.includes(bot)) return Response.json({ error: "The bot isn’t a co-host of this event" }, { status: 400 });
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

/** The bot's NEAR account, which the confirm page adds as co-host. Public. */
export function GET() {
  return Response.json({ bot: process.env.RELAYER_ACCOUNT_ID ?? null });
}
