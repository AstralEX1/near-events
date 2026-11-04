// Time zones: the host picks wall-clock time in a zone, we store UTC ms.

export const LOCAL_TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

/** Milliseconds the zone is ahead of UTC at instant `ts`. */
export function zoneOffset(tz: string, ts: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(ts)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
}

/** "2026-11-05" + "18:30" in `tz` → UTC ms. */
export function toEpoch(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - zoneOffset(tz, wall);
  return wall - zoneOffset(tz, first);
}

/** UTC ms → wall-clock date and time in `tz`. */
export function fromEpoch(ts: number, tz: string): { date: string; time: string } {
  const s = new Date(ts + zoneOffset(tz, ts)).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

export function gmtLabel(tz: string, ts = Date.now()): string {
  const min = Math.round(zoneOffset(tz, ts) / 60000);
  const a = Math.abs(min);
  return `GMT${min < 0 ? "−" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

export const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");

export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

