export type GuestNames = Record<string, string>;

export const guestNamesApi = {
  async list(eventId: number): Promise<GuestNames> {
    const r = await fetch(`/api/guest-names?e=${encodeURIComponent(String(eventId))}`, { cache: "no-store" });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error ?? "Could not load guest names");
    return (json.names ?? {}) as GuestNames;
  },
  async save(eventId: number, name: string, token: string): Promise<void> {
    const r = await fetch("/api/guest-names", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, name }),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error ?? "Could not save your name");
  },
};
