import { events, formatUsdc } from "@/lib/near";
import { rateLimited } from "@/lib/ratelimit";
import { addGuest, approveGuest, unseal } from "@/lib/luma";
import { loadStore, updateStore } from "@/lib/telegram";
import { esc, notifyHost } from "@/lib/notify";

// The widget calls this right after a guest's deposit lands. We check the
// chain ourselves (the caller's word proves nothing), then put the guest on
// the host's Luma list as Going so Luma sends its usual ticket.
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("e");
  const link = id ? (await loadStore()).luma?.[id] : undefined;
  return Response.json({ luma: !!link });
}

export async function POST(req: Request) {
  if (rateLimited(req, 10)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const { eventId, accountId, name, email } = await req.json().catch(() => ({}));
  const id = Number(eventId);
  if (!Number.isInteger(id) || typeof accountId !== "string" || typeof email !== "string" || !EMAIL.test(email.trim()))
    return Response.json({ error: "Bad request" }, { status: 400 });
  const cleanName = String(name ?? "").trim().slice(0, 100) || email.split("@")[0];
  const cleanEmail = email.trim().toLowerCase();

  const link = (await loadStore()).luma?.[id];
  if (!link) return Response.json({ luma: false });
  const status = await events.guestStatus(id, accountId).catch(() => null);
  if (!status) return Response.json({ error: "No deposit found for this account" }, { status: 402 });

  // One Luma entry per paid seat: don't let a second email ride on the same deposit.
  const known = link.guests[accountId];
  if (known && known.email !== cleanEmail) return Response.json({ error: "This seat is already linked to another email" }, { status: 409 });
  if (Object.entries(link.guests).some(([acc, g]) => g.email === cleanEmail && acc !== accountId))
    return Response.json({ error: "This email already has a paid seat" }, { status: 409 });

  const apiKey = unseal(link.apiKey);
  if (!known) {
    // Covers both cases: a fresh guest, and one who registered on Luma first and waits in Pending.
    await addGuest(apiKey, link.lumaEventId, { email: cleanEmail, name: cleanName }).catch(() =>
      approveGuest(apiKey, link.lumaEventId, cleanEmail),
    );
    await updateStore((s) => {
      const l = s.luma?.[id];
      if (l) l.guests[accountId] = { email: cleanEmail, name: cleanName };
    });
    const e = await events.get(id);
    await notifyHost(
      id,
      `💰 <b>${esc(cleanName)}</b> (${esc(cleanEmail)}) paid ${e ? formatUsdc(e.deposit) : ""} USDC and is on your Luma list.${e ? `\nPool ${formatUsdc(e.total_pool)} USDC · ${e.guest_count}/${e.capacity}` : ""}`,
    );
  }
  return Response.json({ luma: true, added: true });
}
