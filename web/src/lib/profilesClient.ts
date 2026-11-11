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
  // Demo mode keeps the photo in the browser as a data: URL.
  return json.url.startsWith("data:") ? json.url : new URL(json.url).pathname;
}
