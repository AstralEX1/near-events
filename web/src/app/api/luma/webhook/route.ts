import { events, formatUsdc } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { relayer } from "@/lib/relayer";
import { unseal, verifyWebhook } from "@/lib/luma";
import { PUBLIC_URL, loadStore } from "@/lib/telegram";
import { esc, notifyHost } from "@/lib/notify";

// Luma calls this for the host's calendar (we registered it with ?e=<our event id>).
// Duplicates happen, so every branch is safe to run twice.
export async function POST(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("e"));
  const link = Number.isInteger(id) ? (await loadStore()).luma?.[id] : undefined;
  const raw = await req.text();
  if (!link?.webhookSecret || !verifyWebhook(unseal(link.webhookSecret), req.headers.get("webhook-signature"), raw))
    return new Response("forbidden", { status: 403 });

  const body = JSON.parse(raw);
  const type: string = body.type ?? body.event_type ?? "";
  const data = body.data ?? body;
  const guest = data.guest ?? data;
  const eventApiId: string | undefined = data.event?.api_id ?? data.event_api_id ?? guest.event_api_id;
  if (eventApiId && eventApiId !== link.lumaEventId) return Response.json({ ignored: "other event" });

  const email: string = String(guest.email ?? guest.user_email ?? "").toLowerCase();
  const account = Object.entries(link.guests).find(([, g]) => g.email === email)?.[0];

  if (type.startsWith("event.cancel")) {
    await notifyHost(id, `Your Luma event was cancelled. Return every deposit here:\n${PUBLIC_URL()}/e/${id}/manage`);
    return Response.json({ ok: true });
  }

  const checkedIn = guest.checked_in_at ?? guest.event_tickets?.find?.((t: { checked_in_at?: string }) => t.checked_in_at)?.checked_in_at;
  if (checkedIn && account) {
    // Scanned at the door in the Luma app → mark them on-chain so they share the pool.
    if ((await events.guestStatus(id, account).catch(() => null)) === "Registered") {
      await relayer().callFunction({
        contractId: EVENTS_CONTRACT,
        methodName: "check_in",
        args: { event_id: id, accounts: [account] },
        gas: 50_000_000_000_000n,
      });
      const e = await events.get(id);
      await notifyHost(id, `✅ ${esc(link.guests[account].name)} checked in${e ? ` · ${e.attended_count}/${e.guest_count}` : ""}`);
    }
    return Response.json({ ok: true });
  }

  const status: string = guest.approval_status ?? "";
  if (status === "pending_approval" && email && !account) {
    // Registered on the Luma page directly: they still owe a deposit.
    const e = await events.get(id);
    await notifyHost(
      id,
      `🕓 ${esc(guest.name ?? email)} (${esc(email)}) asked to join on Luma but hasn’t paid the ${e ? formatUsdc(e.deposit) : ""} USDC deposit yet. Send them:\n${PUBLIC_URL()}/embed/e/${id}/join\nThey’re approved automatically once it’s paid.`,
    );
  }
  return Response.json({ ok: true });
}
