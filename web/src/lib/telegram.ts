// Server-only Telegram bot plumbing: Bot API calls, signed links, and a tiny
// JSON store (which chat hosts which event, who we already announced).
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TOKEN = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
};

export const botConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;

/** Where links in bot messages point. Telegram only makes https links clickable. */
export const PUBLIC_URL = () => (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function tg<T = unknown>(method: string, params: object): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result as T;
}

export async function tgDocument(chatId: number, filename: string, content: string, caption?: string) {
  const form = new FormData();
  form.set("chat_id", String(chatId));
  if (caption) form.set("caption", caption);
  form.set("document", new Blob([content], { type: "text/csv" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/sendDocument`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram sendDocument: ${json.description}`);
}

// --- secrets derived from the bot token, so there is nothing extra to configure

const derive = (label: string) => createHmac("sha256", TOKEN()).update(label).digest();

/** Telegram sends this back on every webhook call (setWebhook secret_token). */
export const webhookSecret = () => derive("webhook").toString("hex").slice(0, 48);

export function checkSecret(given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(webhookSecret());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A link token that proves "this chat asked for it", valid for a day. */
export function chatToken(chatId: number): string {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const body = `${chatId}.${exp}`;
  const sig = derive(`link:${body}`).toString("base64url").slice(0, 22);
  return `${body}.${sig}`;
}

export function readChatToken(token: string): number | null {
  const [chat, exp, sig] = token.split(".");
  if (!chat || !exp || !sig) return null;
  const want = derive(`link:${chat}.${exp}`).toString("base64url").slice(0, 22);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(chat);
}

// --- store

export interface Draft {
  step: "title" | "when" | "place" | "deposit" | "capacity";
  title?: string;
  startsAt?: number;
  location?: string;
  deposit?: string;
}

export interface Store {
  /** eventId → chat that manages it, and the guests we already announced. */
  events: Record<string, { chat: number; seen: string[] }>;
  /** chatId → event being drafted with /new. */
  drafts: Record<string, Draft>;
  /** Telegram getUpdates offset for the local poller. */
  offset?: number;
}

const FILE = path.join(process.cwd(), ".data", "telegram.json");
let lock: Promise<unknown> = Promise.resolve();

export async function loadStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return { events: {}, drafts: {} };
  }
}

/** Read-modify-write, one at a time. */
export function updateStore<T>(fn: (s: Store) => T | Promise<T>): Promise<T> {
  const run = lock.then(async () => {
    const s = await loadStore();
    const out = await fn(s);
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(s, null, 2));
    return out;
  });
  lock = run.catch(() => {});
  return run;
}
