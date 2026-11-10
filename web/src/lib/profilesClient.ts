import { events } from "./near";
import type { Profile } from "./profilesShared";

/** Profiles for up to 100 accounts in one request; accounts without a profile are left out. */
export async function getProfiles(accounts: string[]): Promise<Record<string, Profile>> {
  const unique = [...new Set(accounts)];
  if (!unique.length) return {};
  const r = await fetch(`/api/profiles?a=${encodeURIComponent(unique.join(","))}`, { cache: "no-store" });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? "Could not load profiles");
  return json.profiles as Record<string, Profile>;
}

export async function saveProfile(profile: Profile, token: string): Promise<Profile> {
  const r = await fetch("/api/profiles", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? "Could not save your profile");
  return json.profile as Profile;
}

/** Paid events the account was checked in at (escrow, after close) plus ended free events it joined. */
export async function attendedCount(account: string): Promise<number> {
  const [paid, free] = await Promise.all([
    // The deployed escrow has no get_attended_count, so count closed events where the guest is Attended.
    // shortcut: only the 100 most recent events are checked; switch to get_attended_count once the escrow has it.
    events.list().then(async (all) => {
      const statuses = await events.guestStatuses(account, all.map((e) => e.id));
      return all.filter((e, i) => e.status === "Finalized" && statuses[i] === "Attended").length;
    }),
    fetch(`/api/free-events?attended=${encodeURIComponent(account)}`, { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error("Free events unavailable");
      return (await r.json()).count as number;
    }),
  ]);
  return paid + free;
}

/** Downscale and re-encode a photo to a square-ish JPEG, then upload it; returns the `/api/covers/<id>` path. */
export async function uploadAvatar(file: File, token: string): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.min(512, side);
  // Center crop to a square: avatars are shown round.
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not read this photo");
  const r = await fetch("/api/covers", { method: "POST", headers: { "Content-Type": "image/jpeg", Authorization: `Bearer ${token}` }, body: blob });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || typeof json.url !== "string") throw new Error(json.error ?? "Could not upload the photo");
  return new URL(json.url).pathname;
}
