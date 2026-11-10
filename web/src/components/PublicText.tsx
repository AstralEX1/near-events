import { isGoogleMapsLink } from "@/lib/eventImport";

/** A link shows as a short label; older events may hold a plain address, which stays as text. */
export function LocationValue({ value }: { value: string }) {
  const link = value.trim();
  if (!/^https?:\/\/\S+$/i.test(link)) return <PublicText value={value} />;
  const place = mapPlaceName(link);
  return (
    <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline underline-offset-2 hover:text-text">
      {place ? place + " · " + (isGoogleMapsLink(link) ? "Open in Google Maps ↗" : "Open map ↗") : isGoogleMapsLink(link) ? "Open in Google Maps ↗" : "Open map ↗"}
    </a>
  );
}

function mapPlaceName(value: string): string | null {
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

export function PublicText({ value }: { value: string }) {
  return (
    <p className="text-sm text-muted whitespace-pre-wrap break-words">
      {value.split(/(https?:\/\/[^\s]+)/g).map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={index}>{part}</span>;
        let href = part.replace(/[.,;!?]+$/, "");
        while (href.endsWith(")")) {
          const opening = (href.match(/\(/g) ?? []).length;
          const closing = (href.match(/\)/g) ?? []).length;
          if (closing <= opening) break;
          href = href.slice(0, -1);
        }
        const tail = part.slice(href.length);
        try {
          const url = new URL(href);
          if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return <span key={index}>{part}</span>;
          return <span key={index}><a href={url.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">{href}</a>{tail}</span>;
        } catch {
          return <span key={index}>{part}</span>;
        }
      })}
    </p>
  );
}
