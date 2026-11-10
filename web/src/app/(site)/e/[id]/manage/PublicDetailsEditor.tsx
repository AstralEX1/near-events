"use client";

import { useCallback, useEffect, useState } from "react";
import { EventThemePicker } from "@/components/EventThemePicker";
import { useWallet } from "@/lib/wallet";
import { locationProblem, type EventDetails } from "@/lib/eventImport";
import { fallbackEventVisual, validEventVisual, type EventVisualConfig } from "@/lib/event-visuals";
import { rememberEventVisual } from "@/lib/event-visual-client";

const EMPTY_DETAILS: EventDetails = { location: "", description: "", cover_url: null };

export function PublicDetailsEditor({ eventId, title }: { eventId: number; title: string }) {
  const { staffToken } = useWallet();
  const [details, setDetails] = useState<EventDetails>(EMPTY_DETAILS);
  const [originalLocation, setOriginalLocation] = useState("");
  const [visual, setVisual] = useState<EventVisualConfig>(() => fallbackEventVisual(eventId, title));
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [listed, setListed] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    setError(null);
    try {
      const [detailsResponse, visualsResponse] = await Promise.all([
        fetch("/api/event-details?e=" + encodeURIComponent(String(eventId)), { cache: "no-store" }),
        fetch("/api/event-visuals?ids=" + encodeURIComponent(String(eventId)), { cache: "no-store" }),
      ]);
      if (!detailsResponse.ok || !visualsResponse.ok) throw new Error("Could not load the event page settings. Try again.");
      const [detailsBody, visualsBody] = await Promise.all([detailsResponse.json(), visualsResponse.json()]);
      const stored = detailsBody?.details as EventDetails | null | undefined;
      const nextDetails: EventDetails = stored && typeof stored.location === "string" && typeof stored.description === "string"
        ? { location: stored.location, description: stored.description, cover_url: typeof stored.cover_url === "string" ? stored.cover_url : null }
        : EMPTY_DETAILS;
      const storedVisual = visualsBody?.visuals?.[String(eventId)] as unknown;
      setDetails(nextDetails);
      setListed(stored?.public !== false);
      setOriginalLocation(nextDetails.location.trim());
      setVisual(validEventVisual(storedVisual) ? storedVisual : fallbackEventVisual(eventId, title));
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the event page settings.");
    } finally {
      setLoading(false);
    }
  }, [eventId, title]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const location = details.location.trim();
    if (location !== originalLocation) {
      const problem = locationProblem(location);
      if (problem) return setError(problem);
    }
    const description = details.description.trim();
    if (new TextEncoder().encode(description).length > 10_000) return setError("Event details are too long. Shorten them and try again.");
    const rawCover = details.cover_url?.trim() ?? "";
    const coverUrl = rawCover ? safeImageUrl(rawCover) : null;
    if (rawCover && !coverUrl) return setError("Use a public HTTP or HTTPS image link for the cover image.");

    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const token = await staffToken();
      const nextDetails = { location, description, cover_url: coverUrl, public: listed };
      await Promise.all([
        postJson("/api/event-details", { eventId, details: nextDetails }, token),
        postJson("/api/event-visuals", { eventId, visual }, token),
      ]);
      setDetails(nextDetails);
      setOriginalLocation(location);
      rememberEventVisual(eventId, visual);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the event page settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-4 sm:p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Event page</h2>
        <p className="text-sm text-muted mt-1">Change visibility, theme, location, description or cover here. The event name and time stay as created.</p>
      </div>
      {loading ? (
        <p className="text-sm text-muted" role="status">Loading event page settings…</p>
      ) : !loaded ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-warn break-words">{error ?? "Could not load the event page settings."}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>Retry</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <label className="gc-switch-inline !text-[var(--text)]">
            <button type="button" role="switch" aria-checked={listed} className="gc-switch gc-switch-sm" onClick={() => { setListed(!listed); setSaved(false); }}><span aria-hidden /></button>
            <span>{listed ? "Public: shown in Events" : "Private: only people with the link"}</span>
          </label>
          <EventThemePicker value={visual} title={title} coverUrl={details.cover_url} onChange={(next) => { setVisual(next); setSaved(false); }} />
          <label className="block space-y-1.5">
            <span className="label">Location (optional)</span>
            <input
              className="lu-field w-full px-3 py-2 text-sm"
              inputMode="url"
              autoComplete="off"
              value={details.location}
              onChange={(event) => { setDetails((current) => ({ ...current, location: event.target.value })); setSaved(false); }}
              placeholder="Google Maps link"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="label">Event details (optional)</span>
            <textarea
              className="lu-field w-full px-3 py-2 text-sm min-h-28 resize-y"
              maxLength={10_000}
              value={details.description}
              onChange={(event) => { setDetails((current) => ({ ...current, description: event.target.value })); setSaved(false); }}
              placeholder="Description, host contacts and useful links"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="label">Custom cover image (optional)</span>
            <input
              className="lu-field w-full px-3 py-2 text-sm"
              type="url"
              value={details.cover_url ?? ""}
              onChange={(event) => { setDetails((current) => ({ ...current, cover_url: event.target.value || null })); setSaved(false); }}
              placeholder="Public image link"
            />
            {details.cover_url && safeImageUrl(details.cover_url) && <img src={safeImageUrl(details.cover_url)!} alt="Custom cover image preview" referrerPolicy="no-referrer" className="w-full max-h-56 rounded-xl object-cover" />}
          </label>
          {error && <p role="alert" className="text-sm text-warn break-words">{error}</p>}
          {saved && <p role="status" className="text-sm text-good">Event page settings saved.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save event page"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={saving}>Reload</button>
          </div>
        </form>
      )}
    </section>
  );
}

async function postJson(path: string, body: object, token: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error ?? "Could not save the event page settings.");
}

function safeImageUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
