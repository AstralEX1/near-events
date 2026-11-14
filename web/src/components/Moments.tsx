"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { mayRemove, type Moment } from "@/lib/momentsShared";
import { Icon, Section } from "./EventSections";
import { confirmAction, toast } from "./SlUi";

const PLUS = ["M12 5v14", "M5 12h14"];
const MAX_BYTES = 600_000; // the server's MAX_COVER_BYTES

/** Re-encodes a photo to a JPEG under the upload cap; this also drops its location data. */
async function toJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(`Could not read ${file.name}`);
  });
  for (const side of [1600, 1280, 1024]) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.82));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error(`${file.name} is too large`);
}

/**
 * Photos from a past event. Anyone sees them; guests, the host and the door team add them.
 * `query` is the event's API id: `e=<id>` or `f=<id>`.
 */
export function Moments({ query, canAdd, isHost }: { query: string; canAdd: boolean; isHost: boolean }) {
  const { accountId, staffToken } = useWallet();
  const [moments, setMoments] = useState<Moment[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () => fetch(`/api/moments?${query}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      // Newest first, so a new photo shows up where you look.
      .then((j) => setMoments([...(j.moments as Moment[])].reverse()), () => setMoments((old) => old ?? [])),
    [query],
  );
  useEffect(() => void load(), [load]);

  useEffect(() => {
    const d = dialog.current;
    if (open !== null && d && !d.open) d.showModal();
    if (open === null && d?.open) d.close();
  }, [open]);

  const add = async (files: File[]) => {
    if (!files.length) return;
    try {
      const token = await staffToken();
      for (const [i, file] of files.entries()) {
        setBusy(files.length === 1 ? "Adding…" : `Adding ${i + 1} of ${files.length}…`);
        const r = await fetch(`/api/moments?${query}`, { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${token}` }, body: await toJpeg(file) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? "Could not add the photo");
      }
      toast(files.length === 1 ? "Photo added" : `${files.length} photos added`);
    } catch (e) {
      toast("Photos not added", e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const remove = async (m: Moment) => {
    setOpen(null); // the confirm dialog can't sit above a modal <dialog>
    if (!(await confirmAction("Remove this photo?\nIt disappears from the event page.", "Remove"))) return;
    try {
      const r = await fetch(`/api/moments?${query}&m=${m.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${await staffToken()}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Could not remove the photo");
      toast("Photo removed");
    } catch (e) {
      toast("Photo not removed", e instanceof Error ? e.message : String(e), "error");
    }
    await load();
  };

  if (!moments || (!moments.length && !canAdd)) return null;
  const shown = open === null ? null : moments[open];
  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + moments.length) % moments.length));

  return (
    <Section label={`Moments${moments.length ? ` · ${moments.length}` : ""}`}>
      {canAdd && !moments.length && <p className="text-sm text-muted mb-3">Share your photos from the event.</p>}
      <div className="grid grid-cols-3 gap-1.5">
        {canAdd && (
          <button type="button" disabled={!!busy} onClick={() => input.current?.click()}
            className="aspect-square rounded-xl border border-dashed border-border flex flex-col items-center justify-center gap-1 text-sm text-muted hover:text-text disabled:cursor-progress">
            <Icon paths={PLUS} />
            <span>{busy ?? "Add Photos"}</span>
          </button>
        )}
        {moments.map((m, i) => (
          <button key={m.id} type="button" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}`} className="aspect-square rounded-xl overflow-hidden bg-text/5">
            {/* shortcut: the grid loads the full photo (≤600 KB); add thumbnails if events collect many photos. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {canAdd && (
        <input ref={input} type="file" accept="image/*" multiple hidden
          onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void add(files); }} />
      )}

      <dialog ref={dialog} onClose={() => setOpen(null)} onClick={(e) => e.target === e.currentTarget && setOpen(null)}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); }}
        className="m-auto bg-transparent p-0 max-w-[94vw] max-h-[94vh] overflow-visible backdrop:bg-black/85">
        {shown && (
          <div className="relative flex flex-col items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown.url} alt={`Photo ${open! + 1} of ${moments.length}`} className="max-w-[94vw] max-h-[80vh] object-contain rounded-xl" />
            <div className="flex items-center gap-2 text-sm text-white">
              {moments.length > 1 && <button type="button" className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25" aria-label="Previous photo" onClick={() => step(-1)}>←</button>}
              <span className="px-2 tabular-nums">{open! + 1} / {moments.length}</span>
              {moments.length > 1 && <button type="button" className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25" aria-label="Next photo" onClick={() => step(1)}>→</button>}
              {accountId && mayRemove(shown, accountId, isHost) && (
                <button type="button" className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25" onClick={() => void remove(shown)}>Remove</button>
              )}
              <button type="button" className="px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25" onClick={() => setOpen(null)}>Close</button>
            </div>
          </div>
        )}
      </dialog>
    </Section>
  );
}
