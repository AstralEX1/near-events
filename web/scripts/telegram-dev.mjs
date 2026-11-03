// Runs the Telegram bot locally without a public URL: long-polls Telegram and
// forwards each update to the app's webhook route, and pings the deposit
// notifier every 20 s. Needs TELEGRAM_BOT_TOKEN in .env.local (never printed).
//   node --env-file=.env.local scripts/telegram-dev.mjs
import { createHmac } from "node:crypto";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN in web/.env.local");
const APP = process.env.APP_URL ?? "http://localhost:3000";
const secret = createHmac("sha256", TOKEN).update("webhook").digest("hex").slice(0, 48);
const api = (m, p) =>
  fetch(`https://api.telegram.org/bot${TOKEN}/${m}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((r) => r.json());
const forward = (path, body) =>
  fetch(APP + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body ?? {}),
  }).catch((e) => console.error(path, e.message));

await api("deleteWebhook", {}); // polling and a webhook can't run at once
await api("setMyCommands", {
  commands: [
    { command: "new", description: "Create an event" },
    { command: "status", description: "Your events, pool and buttons" },
    { command: "luma", description: "Connect a Luma event (Luma Plus)" },
  ],
});
const me = await api("getMe", {});
console.log(`Bot @${me.result?.username} is running. Ctrl+C to stop.`);

setInterval(() => forward("/api/telegram/tick"), 20_000);

let offset = 0;
for (;;) {
  const r = await api("getUpdates", { offset, timeout: 30 }).catch(() => ({ result: [] }));
  for (const u of r.result ?? []) {
    offset = u.update_id + 1;
    await forward("/api/telegram", u);
  }
}
