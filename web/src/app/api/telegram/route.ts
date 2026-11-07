import { events, formatUsdc, type EventView, type GuestView } from "@/lib/near";
import { listCheckIns, setCheckIn, withCheckIns } from "@/lib/checkins";
import { PUBLIC_URL, checkSecret, chatToken, loadStore, tg, tgDocument, updateStore, type Draft } from "@/lib/telegram";

// The host's admin lives in Telegram. Telegram posts every update here
// (webhook in production, scripts/telegram-dev.mjs locally).

interface Msg {
  message_id: number;
  chat: { id: number };
  text?: string;
}
interface Update {
  message?: Msg;
  callback_query?: { id: string; data?: string; message?: Msg };
}

type Button = { text: string; callback_data?: string; url?: string };

const short = (a: string) => (/^([0-9a-f]{64}|0x[0-9a-f]{40})$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const PAGE = 8;

export async function POST(req: Request) {
  if (!checkSecret(req.headers.get("x-telegram-bot-api-secret-token"))) return new Response("forbidden", { status: 403 });
  const update = (await req.json()) as Update;
  try {
    if (update.callback_query) await onButton(update.callback_query);
    else if (update.message?.text) await onText(update.message.chat.id, update.message.text.trim());
  } catch (e) {
    const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chat) await say(chat, `Something went wrong: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
  }
  return Response.json({ ok: true });
}

function say(chat: number, text: string, buttons?: Button[][]) {
  return tg("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

/** Telegram refuses non-https button links, so local links go in the text. */
function linkOrButton(label: string, url: string): { text: string; buttons?: Button[][] } {
  return url.startsWith("https://") ? { text: "", buttons: [[{ text: label, url }]] } : { text: `\n${label}: ${url}` };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ------------------------------------------------------------------ text

async function onText(chat: number, text: string) {
  const cmd = text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if (cmd === "/start" || cmd === "/help") return help(chat);
  if (cmd === "/new") return startDraft(chat);
  if (cmd === "/events" || cmd === "/status") return listEvents(chat);
  if (cmd === "/cancel") {
    await updateStore((s) => void delete s.drafts[chat]);
    return say(chat, "Okay, dropped the draft.");
  }
  const draft = (await loadStore()).drafts[chat];
  if (draft) return continueDraft(chat, draft, text);
  return help(chat);
}

function help(chat: number) {
  return say(
    chat,
    [
      "<b>Near Me</b> takes a refundable deposit when guests register for your events.",
      "",
      "Guests register and pay a small refundable deposit with a button on your own website. People who come get it back plus a share of the no-shows.",
      "",
      "I message you on every registration, and from here you can see the guest list, check people in at the door and pay out.",
      "",
      "/new: create an event",
      "/status: your events, pools and buttons",
    ].join("\n"),
  );
}

async function startDraft(chat: number) {
  await updateStore((s) => void (s.drafts[chat] = { step: "title" }));
  return say(chat, "What’s the event called?\n\n(/cancel to stop)");
}

const PROMPTS: Record<Draft["step"], string> = {
  title: "What’s the event called?",
  when: "When does it start? For example <code>2026-11-14 19:00</code> (your local time).",
  place: "Location details are no longer collected. How much is the deposit per guest in USDC?",
  deposit: "Deposit per guest in USDC? For example <code>10</code>.",
  capacity: "How many spots? (max 300)",
};

async function continueDraft(chat: number, d: Draft, text: string) {
  if (d.step === "place") {
    await updateStore((s) => void (s.drafts[chat] = { step: "deposit", title: d.title, startsAt: d.startsAt, deposit: d.deposit }));
    return say(chat, PROMPTS.deposit);
  }

  let next: Draft["step"] | null = null;
  if (d.step === "title") {
    if (text.length > 120) return say(chat, "Please keep it under 120 characters.");
    d.title = text;
    next = "when";
  } else if (d.step === "when") {
    const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
    if (!m) return say(chat, `I didn’t get that. ${PROMPTS.when}`);
    // Kept as wall-clock time; the confirm page reads it in the host's own time zone.
    d.startsAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    next = "deposit";
  } else if (d.step === "deposit") {
    const n = Number(text.replace(",", "."));
    if (!(n > 0 && n <= 10_000)) return say(chat, "A number of USDC, like 10.");
    d.deposit = String(n);
    next = "capacity";
  } else if (d.step === "capacity") {
    const n = Number(text);
    if (!(Number.isInteger(n) && n >= 1 && n <= 300)) return say(chat, "A whole number from 1 to 300.");
    await updateStore((s) => void delete s.drafts[chat]);
    const start = new Date(d.startsAt!).toISOString().slice(0, 16);
    const q = new URLSearchParams({
      t: chatToken(chat),
      title: d.title!,
      start,
      deposit: d.deposit!,
      cap: String(n),
    });
    const url = `${PUBLIC_URL()}/host/new?${q}`;
    const l = linkOrButton("Confirm and create", url);
    return say(
      chat,
      `<b>${esc(d.title!)}</b>\n${start.replace("T", " ")}\n${d.deposit} USDC deposit · ${n} spots\n\nOne last step: confirm it with your Google account or NEAR wallet. The event belongs to you; I only get permission to check guests in.${l.text}`,
      l.buttons,
    );
  }
  d.step = next!;
  await updateStore((s) => void (s.drafts[chat] = d));
  return say(chat, PROMPTS[next!]);
}

// ------------------------------------------------------------------ events

async function myEvents(chat: number): Promise<EventView[]> {
  const ids = Object.entries((await loadStore()).events)
    .filter(([, v]) => v.chat === chat)
    .map(([k]) => Number(k));
  const list = await Promise.all(ids.map((id) => events.get(id).catch(() => null)));
  return Promise.all(
    list
      .filter((e): e is EventView => !!e)
      .map(async (e) =>
        e.status === "Open" ? { ...e, attended_count: Object.keys(await listCheckIns(e.id)).length } : e,
      ),
  );
}

async function listEvents(chat: number) {
  const list = await myEvents(chat);
  if (list.length === 0) return say(chat, "No events yet. /new to create one.");
  for (const e of list) await sendEvent(chat, e);
}

function eventText(e: EventView) {
  const when = new Date(e.metadata.starts_at).toISOString().slice(0, 16).replace("T", " ");
  const status = e.status === "Open" ? "" : e.status === "Finalized" ? " · paid out" : " · cancelled";
  return `<b>${esc(e.metadata.title)}</b> (#${e.id})${status}\n${when} UTC\n${e.guest_count}/${e.capacity} registered · ${e.attended_count} checked in · pool ${formatUsdc(e.total_pool)} USDC`;
}

function sendEvent(chat: number, e: EventView) {
  const open = e.status === "Open";
  const rows: Button[][] = [
    [
      { text: "Guests", callback_data: `g:${e.id}` },
      { text: "CSV", callback_data: `x:${e.id}` },
    ],
  ];
  if (open)
    rows.splice(1, 0, [{ text: "Check in at the door", callback_data: `c:${e.id}:0` }], [
      { text: "Close & pay out", callback_data: `p:${e.id}` },
      { text: "Cancel & refund everyone", callback_data: `r:${e.id}` },
    ]);
  rows.push([{ text: "Website button", callback_data: `w:${e.id}` }]);
  return say(chat, eventText(e), rows);
}

// ------------------------------------------------------------------ buttons

async function onButton(q: { id: string; data?: string; message?: Msg }) {
  const chat = q.message?.chat.id;
  const [kind, idStr, arg] = (q.data ?? "").split(":");
  const id = Number(idStr);
  if (!chat || !Number.isInteger(id)) return tg("answerCallbackQuery", { callback_query_id: q.id });
  // Only the chat that created the event may act on it.
  if ((await loadStore()).events[id]?.chat !== chat)
    return tg("answerCallbackQuery", { callback_query_id: q.id, text: "This event isn’t managed from this chat.", show_alert: true });

  const [onChain, chainGuests] = await Promise.all([events.get(id), events.guests(id).catch((): GuestView[] => [])]);
  if (!onChain) return tg("answerCallbackQuery", { callback_query_id: q.id, text: "Event not found" });
  await tg("answerCallbackQuery", { callback_query_id: q.id });
  const { e, guests } = await withCheckIns(onChain, chainGuests);

  if (kind === "g") {
    if (guests.length === 0) return say(chat, "No one has registered yet.");
    const lines = guests.map((g, i) => `${i + 1}. ${g.status === "Attended" ? "✅" : "▫️"} ${esc(short(g.account_id))}`);
    return say(chat, `<b>${esc(e.metadata.title)}</b>: ${guests.length} registered, ${e.attended_count} checked in\n\n${lines.join("\n")}`);
  }
  if (kind === "x") {
    const rows = [["account", "status", "registered_at", "paid_by"], ...guests.map((g) => [g.account_id, g.status, new Date(g.registered_at).toISOString(), g.paid_by])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    return tgDocument(chat, `event-${id}-guests.csv`, csv, "Opens in Google Sheets or Excel.");
  }
  if (kind === "c") return checkInKeyboard(chat, e, guests, Number(arg) || 0);
  if (kind === "k") {
    const g = guests[Number(arg)];
    if (!g) return say(chat, "That guest isn’t on the list any more.");
    if (g.status === "Attended") return say(chat, `${esc(short(g.account_id))} is already checked in.`);
    await setCheckIn(id, g.account_id, true, "telegram");
    await say(chat, `✅ ${esc(short(g.account_id))} checked in.`);
    return checkInKeyboard(chat, { ...e, attended_count: e.attended_count + 1 }, guests.map((x) => (x === g ? { ...x, status: "Attended" } : x)), 0);
  }
  if (kind === "p" || kind === "r") {
    // Moving money is the host's call: they confirm it with their own account.
    const share = e.attended_count > 0 ? BigInt(e.total_pool) / BigInt(e.attended_count) : 0n;
    const what =
      kind === "p"
        ? e.attended_count === 0
          ? "Nobody is checked in, so closing returns every deposit."
          : `${e.attended_count} of ${e.guest_count} came. Each gets ${formatUsdc(share)} USDC.`
        : `Cancel the event and return all ${e.guest_count} deposits.`;
    const l = linkOrButton(kind === "p" ? "Confirm payout" : "Confirm refund", `${PUBLIC_URL()}/e/${id}/manage`);
    return say(chat, `${what}\nConfirm with your account:${l.text}`, l.buttons);
  }
  if (kind === "w") {
    const code = `<script src="${PUBLIC_URL()}/embed.js" async></script>\n<near-event event="${id}" mode="button"></near-event>`;
    return say(
      chat,
      `Checkout button for your website:\n\n<pre>${esc(code)}</pre>\nEvent page: ${PUBLIC_URL()}/e/${id}\nQuick checkout: ${PUBLIC_URL()}/p/${id}\nManage event: ${PUBLIC_URL()}/e/${id}/manage`,
    );
  }
}

async function checkInKeyboard(chat: number, e: EventView, guests: GuestView[], page: number) {
  const waiting = guests.map((g, i) => ({ g, i })).filter(({ g }) => g.status !== "Attended");
  if (waiting.length === 0) return say(chat, `Everyone is checked in (${e.attended_count}/${e.guest_count}).`);
  const slice = waiting.slice(page * PAGE, page * PAGE + PAGE);
  const rows: Button[][] = slice.map(({ g, i }) => [{ text: short(g.account_id), callback_data: `k:${e.id}:${i}` }]);
  const nav: Button[] = [];
  if (page > 0) nav.push({ text: "← Back", callback_data: `c:${e.id}:${page - 1}` });
  if ((page + 1) * PAGE < waiting.length) nav.push({ text: "More →", callback_data: `c:${e.id}:${page + 1}` });
  if (nav.length) rows.push(nav);
  return say(chat, `Tap a guest to check them in. ${e.attended_count}/${e.guest_count} in so far.`, rows);
}
