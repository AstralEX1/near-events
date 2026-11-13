// Browser side of door check-in (see app/api/checkin and lib/checkins.ts).
export type CheckIns = Record<string, { at: number; by: string }>;

export type CheckInEntry = { account: string; on: boolean; at: number; by: string };

export const checkIns = {
  /** Every mark and unmark, oldest first (public; the dispute council reads it). */
  log: async (eventId: number): Promise<CheckInEntry[]> => {
    const r = await fetch(`/api/checkin?e=${eventId}&log=1`, { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load the check-in log");
    return (await r.json()).log;
  },
  list: async (eventId: number): Promise<CheckIns> => {
    const r = await fetch(`/api/checkin?e=${eventId}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load check-ins");
    return (await r.json()).checkedIn;
  },
  set: async (token: string, eventId: number, account: string, on: boolean): Promise<void> => {
    const r = await fetch("/api/checkin", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventId, account, on }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Check-in failed");
  },
};
