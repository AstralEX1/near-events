// Server-only: tell the host's Telegram chat about something on one of their events.
import "server-only";
import { botConfigured, loadStore, tg } from "./telegram";

export async function notifyHost(eventId: number, html: string): Promise<void> {
  if (!botConfigured()) return;
  const chat = (await loadStore()).events[eventId]?.chat;
  if (!chat) return;
  await tg("sendMessage", { chat_id: chat, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } }).catch(() => {});
}

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
