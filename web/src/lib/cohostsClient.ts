// Browser side of the door team (see app/api/cohosts and lib/cohosts.ts).
export const cohosts = {
  get: async (eventId: number): Promise<string[]> => {
    const r = await fetch(`/api/cohosts?e=${eventId}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Could not load the door team");
    return (await r.json()).cohosts;
  },
  /** Door teams of any number of events, 100 per request. Missing events map to []. */
  many: async (eventIds: number[]): Promise<Record<number, string[]>> => {
    const out: Record<number, string[]> = {};
    for (let i = 0; i < eventIds.length; i += 100) {
      const r = await fetch(`/api/cohosts?ids=${eventIds.slice(i, i + 100).join(",")}`, { cache: "no-store" });
      if (!r.ok) throw new Error("Could not load door teams");
      Object.assign(out, (await r.json()).cohosts);
    }
    return out;
  },
  save: async (token: string, eventId: number, list: string[]): Promise<string[]> => {
    const r = await fetch("/api/cohosts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, cohosts: list }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error ?? "Could not save the door team");
    return json.cohosts;
  },
};
