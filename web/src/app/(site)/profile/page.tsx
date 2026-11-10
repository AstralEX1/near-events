"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { ProfileCard } from "@/components/ProfileCard";
import { getProfiles, saveProfile, uploadAvatar } from "@/lib/profilesClient";
import { useReputation } from "@/lib/reputation";
import { EMPTY_PROFILE, cleanProfile, type LinkKind, type Profile } from "@/lib/profilesShared";

export default function MyProfile() {
  const { accountId } = useWallet();
  if (!accountId) return (
    <div className="gc-checkout space-y-6 mt-6">
      <h1 className="gc-page-title">My profile</h1>
      <SignInOptions />
    </div>
  );
  return <Editor key={accountId} accountId={accountId} />;
}

const LINKS: [LinkKind, string, string][] = [
  ["x", "X", "@handle"],
  ["telegram", "Telegram", "@handle"],
  ["instagram", "Instagram", "@handle"],
  ["website", "Website", "https://"],
];

function Editor({ accountId }: { accountId: string }) {
  const { staffToken } = useWallet();
  const [saved, setSaved] = useState<Profile | null>(null);
  const [form, setForm] = useState<Profile | null>(null);
  const reputation = useReputation(accountId);
  const [busy, setBusy] = useState<"photo" | "save" | null>(null);
  const [status, setStatus] = useState("");
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProfiles([accountId])
      // A new profile gets a random generated avatar, like a new event gets a random theme; it is kept on first save.
      .then((p) => { setSaved(p[accountId] ?? null); setForm(p[accountId] ?? { ...EMPTY_PROFILE, avatar_seed: crypto.getRandomValues(new Uint32Array(1))[0] }); })
      .catch(() => { setForm(EMPTY_PROFILE); setStatus("Could not load your profile."); });
  }, [accountId]);

  if (!form) return <p className="text-muted" role="status">Loading…</p>;

  const edit = (patch: Partial<Profile>) => { setForm({ ...form, ...patch }); setStatus(""); };

  async function onPhoto(f: File | undefined) {
    if (!f) return;
    setBusy("photo");
    try {
      edit({ avatar_url: await uploadAvatar(f, await staffToken()) });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not upload the photo");
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    const checked = cleanProfile(form);
    if ("error" in checked) return setStatus(checked.error);
    setBusy("save");
    try {
      const profile = await saveProfile(checked.profile, await staffToken());
      setSaved(profile);
      setForm(profile);
      setStatus("Saved");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  const field = "lu-field w-full px-3 py-2 text-sm";
  return (
    <div className="max-w-xl mx-auto space-y-8 pt-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="gc-page-title">My profile</h1>
        <Link href={`/u/${encodeURIComponent(accountId)}`} className="text-sm text-accent font-medium shrink-0">Public page ↗</Link>
      </div>
      <ProfileCard account={accountId} profile={{ ...(saved ?? EMPTY_PROFILE), avatar_url: form.avatar_url, avatar_seed: form.avatar_seed }} reputation={reputation} />

      <form onSubmit={onSave} className="card p-6 space-y-5">
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-ghost text-sm" disabled={busy !== null} onClick={() => file.current?.click()}>
            {busy === "photo" ? "Uploading…" : form.avatar_url ? "Change photo" : "Upload photo"}
          </button>
          {form.avatar_url && <button type="button" className="btn btn-ghost text-sm" disabled={busy !== null} onClick={() => edit({ avatar_url: null })}>Remove photo</button>}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void onPhoto(e.target.files?.[0])} />
        </div>
        <label className="block space-y-1.5">
          <span className="label">Username</span>
          <input className={field} value={form.username} onChange={(e) => edit({ username: e.target.value })} placeholder="username" autoComplete="username" maxLength={21} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="label">First name</span>
            <input className={field} value={form.first_name} onChange={(e) => edit({ first_name: e.target.value })} autoComplete="given-name" maxLength={60} />
          </label>
          <label className="block space-y-1.5">
            <span className="label">Last name</span>
            <input className={field} value={form.last_name} onChange={(e) => edit({ last_name: e.target.value })} autoComplete="family-name" maxLength={60} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {LINKS.map(([kind, label, placeholder]) => (
            <label key={kind} className="block space-y-1.5">
              <span className="label">{label}</span>
              <input className={field} value={form.links[kind] ?? ""} placeholder={placeholder} inputMode="url" autoComplete="off"
                onChange={(e) => edit({ links: { ...form.links, [kind]: e.target.value } })} />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <button className="btn btn-primary" disabled={busy !== null}>{busy === "save" ? "Saving…" : "Save"}</button>
          {status && <p className="text-sm" role="status">{status}</p>}
        </div>
      </form>
    </div>
  );
}
