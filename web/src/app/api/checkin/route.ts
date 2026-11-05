import { events } from "@/lib/near";
import { listCheckIns, setCheckIn } from "@/lib/checkins";
import { readStaffToken, staffEvent } from "@/lib/staff";

// Door check-ins, kept here until the host finalizes on-chain.
// GET ?e=<event id> → { checkedIn: { account: { at, by } } }  (public, like the guest list)
// POST { event, account, on } with "Authorization: Bearer <staff token>"
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("e"));
  if (!Number.isInteger(id) || id < 0) return Response.json({ error: "Bad event id" }, { status: 400 });
  return Response.json({ checkedIn: await listCheckIns(id) });
}

export async function POST(req: Request) {
  const staff = readStaffToken(req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""));
  if (!staff) return Response.json({ error: "Sign in again to check guests in" }, { status: 401 });
  const { event, account, on } = (await req.json().catch(() => ({}))) as { event?: number; account?: string; on?: boolean };
  if (!Number.isInteger(event) || typeof account !== "string") return Response.json({ error: "Bad request" }, { status: 400 });
  const e = await staffEvent(event!, staff);
  if (!e) return Response.json({ error: "Only the host or a co-host can check guests in" }, { status: 403 });
  if (e.status !== "Open") return Response.json({ error: "The event is closed" }, { status: 409 });
  if ((await events.guestStatus(event!, account).catch(() => null)) == null)
    return Response.json({ error: `${account} is not registered` }, { status: 404 });
  await setCheckIn(event!, account, on !== false, staff);
  return Response.json({ ok: true, checkedIn: await listCheckIns(event!) });
}
