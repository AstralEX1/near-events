// Pure text helpers for the event page (no JSX), so node tests can import them.

/** "Sam, Hasan and 12 others", the line Luma shows under the avatars. */
export function goingLine(names: string[], total: number): string {
  const [a, b] = names;
  if (!a) return "";
  if (total <= 1 || !b) return total > 1 ? `${a} and ${total - 1} other${total === 2 ? "" : "s"}` : a;
  if (total === 2) return `${a} and ${b}`;
  return `${a}, ${b} and ${total - 2} other${total === 3 ? "" : "s"}`;
}

export function mapPlaceName(value: string): string | null {
  try {
    const url = new URL(value);
    const query = url.searchParams.get("query") ?? url.searchParams.get("q");
    if (query && !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(query) && !query.startsWith("place_id:")) return query.slice(0, 120);
    const path = url.pathname.match(/\/maps\/place\/([^/]+)/i)?.[1];
    return path ? decodeURIComponent(path.replace(/\+/g, " ")).slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** What to show on an embedded map: the place name, or the "@lat,lng" pin of a Google Maps link. Null for short links. */
export function mapQuery(value: string): string | null {
  const link = value.trim();
  if (!/^https?:\/\/\S+$/i.test(link)) return link || null;
  const place = mapPlaceName(link);
  if (place) return place;
  try {
    const url = new URL(link);
    const q = url.searchParams.get("query") ?? url.searchParams.get("q");
    if (q && /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(q)) return q.replace(/\s/g, "");
    return url.pathname.match(/@(-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?)/)?.[1] ?? null;
  } catch {
    return null;
  }
}
