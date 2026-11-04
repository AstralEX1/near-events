import { events, formatUsdc } from "@/lib/near";
import { botConfigured, checkSecret, loadStore, updateStore } from "@/lib/telegram";
import { esc, notifyHost } from "@/lib/notify";

// Called every ~20 s (scripts/telegram-dev.mjs locally, a cron in production):
// announces new deposits on every event managed from Telegram.
export async function POST(req: Request) {
  if (!botConfigured() || !checkSecret(req.headers.get("x-telegram-bot-api-secret-token")))
    return new Response("forbidden", { status: 403 });
  const store = await loadStore();
  let sent = 0;
  for (const [idStr, ev] of Object.entries(store.events)) {
    const id = Number(idStr);
    const [e, guests] = await Promise.all([events.get(id).catch(() => null), events.guests(id).catch(() => [])]);
    if (!e || e.status !== "Open") continue;
    const viaLuma = store.luma?.[idStr]?.guests ?? {};
    const fresh = guests.filter((g) => !ev.seen.includes(g.account_id));
    if (fresh.length === 0) continue;
    for (const g of fresh) {
      if (viaLuma[g.account_id]) continue; // already announced with name and email
      await notifyHost(
        id,
        `💰 <b>${esc(g.account_id.length > 20 ? `${g.account_id.slice(0, 8)}…${g.account_id.slice(-4)}` : g.account_id)}</b> paid ${formatUsdc(e.deposit)} USDC for ${esc(e.metadata.title)}\nPool ${formatUsdc(e.total_pool)} USDC · ${e.guest_count}/${e.capacity}`,
      );
      sent++;
    }
    await updateStore((s) => {
      const x = s.events[idStr];
      if (x) x.seen = [...new Set([...x.seen, ...fresh.map((g) => g.account_id)])];
    });
  }
  return Response.json({ ok: true, sent });
}
