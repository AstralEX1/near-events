import { events } from "@/lib/near";
import { checkInLog, listCheckIns, setCheckIn } from "@/lib/checkins";
import { rateLimited } from "@/lib/ratelimit";
import { readStaffToken, staffEvent } from "@/lib/staff";

// Door check-ins, kept here until the host finalizes on-chain.
// GET ?e=<event id> → { checkedIn: { account: { at, by } } }  (public, like the guest list)
// GET ?e=<event id>&log=1 → { log: [{ account, on, at, by }] }: every mark and unmark, for the dispute council
// POST { event, account, on } with "Authorization: Bearer <staff token>"
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("e"));
  if (!Number.isInteger(id) || id < 0) return Response.json({ error: "Bad event id" }, { status: 400 });
  if (new URL(req.url).searchParams.has("log")) return Response.json({ log: await checkInLog(id) });
  return Response.json({ checkedIn: await listCheckIns(id) });
}

export async function POST(req: Request) {
  // A busy door: 300 guests in a few minutes is fine; an endless writer is not.
  if (rateLimited(req, 120)) return Response.json({ error: "Too many requests" }, { status: 429 });
  const staff = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!staff) return Response.json({ error: "Sign in again to check guests in" }, { status: 401 });
  const { event, account, on } = (await req.json().catch(() => ({}))) as { event?: number; account?: string; on?: boolean };
  if (!Number.isInteger(event) || typeof account !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  const e = await staffEvent(event!, staff);
  if (!e) return Response.json({ error: "Only the host or the door team can check guests in" }, { status: 403 });
  // The log freezes once the host publishes the list (or the event closes).
  if (e.status !== "Open") return Response.json({ error: "The event is closed" }, { status: 409 });
  if ((await events.guestStatus(event!, account).catch(() => null)) == null)
    return Response.json({ error: `${account} is not registered` }, { status: 404 });
  // The log is public and read whole: cap it at a few marks per seat.
  if ((await checkInLog(event!)).length >= 4 * e.capacity + 50) {
    return Response.json({ error: "The door log is full for this event" }, { status: 409 });
  }
  await setCheckIn(event!, account, on !== false, staff);
  return Response.json({ ok: true, checkedIn: await listCheckIns(event!) });
}
