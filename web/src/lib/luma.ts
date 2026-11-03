// Server-only Luma connector (needs the host's Luma Plus API key).
// We sit in front of Luma: a guest pays the deposit with us, then we add them
// to the Luma event as Going, and Luma sends its usual ticket and QR. When the
// host scans that QR in the Luma app, Luma's webhook tells us and we check the
// guest in on-chain. Docs: https://docs.luma.com/reference
import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const API = "https://public-api.luma.com";

// --- secrets at rest: AES-256-GCM with a key from APP_SECRET (or the relayer key as a fallback)

function key(): Buffer {
  const secret = process.env.APP_SECRET ?? process.env.RELAYER_PRIVATE_KEY;
  if (!secret) throw new Error("Set APP_SECRET to store Luma keys");
  return createHash("sha256").update(`luma:${secret}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

// --- API

async function call<T>(apiKey: string, method: "GET" | "POST", path: string, body?: object): Promise<T> {
  const url = new URL(API + path);
  if (method === "GET" && body) for (const [k, v] of Object.entries(body)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { "x-luma-api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Luma ${path}: ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export interface LumaEvent {
  api_id: string;
  name: string;
  start_at?: string;
  url?: string;
}

export async function getEvent(apiKey: string, eventId: string): Promise<LumaEvent> {
  const r = await call<{ event?: LumaEvent } & LumaEvent>(apiKey, "GET", "/v1/events/get", { api_id: eventId });
  return r.event ?? r;
}

/** Adds a paid guest as Going. Luma emails them its normal ticket with the QR code. */
export function addGuest(apiKey: string, eventId: string, guest: { email: string; name: string }) {
  return call(apiKey, "POST", "/v1/events/guests/add", {
    event_api_id: eventId,
    guests: [{ email: guest.email, name: guest.name }],
    approval_status: "approved",
    send_email: true,
  });
}

/** Approves a guest who registered on Luma directly (Pending) once their deposit is in. */
export function approveGuest(apiKey: string, eventId: string, email: string) {
  return call(apiKey, "POST", "/v1/events/guests/update-status", {
    event_api_id: eventId,
    guest: { type: "email", email },
    status: "approved",
    send_email: true,
  });
}

/** Points Luma's webhooks for this calendar at us. Returns the signing secret. */
export async function createWebhook(apiKey: string, url: string): Promise<string | undefined> {
  const r = await call<{ webhook?: { secret?: string }; secret?: string }>(apiKey, "POST", "/v2/webhooks/create", {
    url,
    event_types: ["guest.registered", "guest.updated", "event.canceled"],
  });
  return r.webhook?.secret ?? r.secret;
}

/**
 * Luma signs webhooks like Stripe/Svix: `Webhook-Signature: t=<ts>,v1=<hmac>`,
 * HMAC-SHA256 of `<ts>.<raw body>` with the `whsec_…` secret. Rejects anything
 * older than 10 minutes so a captured call can't be replayed.
 */
export function verifyWebhook(secret: string, header: string | null, body: string): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 600 || !parts.v1) return false;
  const want = createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  const a = Buffer.from(parts.v1);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}
