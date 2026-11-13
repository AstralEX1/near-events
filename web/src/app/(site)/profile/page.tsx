"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { savedAccounts, savedStaffToken, useWallet } from "@/lib/wallet";
import { DEMO_EVM } from "@/lib/demoBackend";
import { SignInOptions } from "@/components/SignIn";
import { ProfileCard } from "@/components/ProfileCard";
import { shortAccount } from "@/components/ui";
import { getProfiles, getWallets, linkWallet, saveProfile, unlinkWallet, uploadAvatar } from "@/lib/profilesClient";
import { useReputation } from "@/lib/reputation";
import { EMPTY_PROFILE, cleanProfile, type LinkKind, type Profile } from "@/lib/profilesShared";

export default function MyProfile() {
  const { accountId, kind } = useWallet();
  // Linking or unlinking a wallet can change which profile this wallet shows: the editor reloads it.
  const [linkRev, setLinkRev] = useState(0);
  if (!accountId) return (
    <div className="gc-checkout space-y-6 mt-6">
      <h1 className="gc-page-title">My profile</h1>
      <SignInOptions />
    </div>
  );
  return (
    <div className="max-w-xl mx-auto space-y-8 pt-4">
      <Editor key={accountId} accountId={accountId} linkRev={linkRev} />
      <Wallets key={`wallets:${accountId}`} accountId={accountId} onChange={() => setLinkRev((n) => n + 1)} />
    </div>
  );
}

const walletKind = (a: string) => (/^0x[0-9a-f]{40}$/i.test(a) ? "EVM" : /^[0-9a-f]{64}$/i.test(a) ? "Google" : "NEAR");

/** Wallets that share this profile. A wallet signed in earlier on this device (its sign-in token is still here) can be linked with one click. */
function Wallets({ accountId, onChange }: { accountId: string; onChange: () => void }) {
  const { staffToken, kind } = useWallet();
  // Demo: the one other wallet is made up, and the demo server takes the account itself as its token.
  const demo = kind === "demo";
  const [wallets, setWallets] = useState<string[]>([accountId]);
  const [others, setOthers] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setOthers(demo ? [DEMO_EVM] : savedAccounts().filter((a) => a !== accountId));
    // Only with a token already here: opening the page never asks the wallet to sign.
    const token = demo ? "demo" : savedStaffToken(accountId);
    if (token) getWallets(token).then(setWallets).catch(() => {});
  }, [accountId, demo]);

  const run = (label: string, fn: (token: string) => Promise<void>) => async () => {
    setBusy(label);
    setError("");
    try {
      await fn(await staffToken());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const change = (label: string, fn: (token: string) => Promise<string[]>) => run(label, async (token) => {
    setWallets(await fn(token));
    onChange();
  });
  const linkable = others.filter((a) => !wallets.includes(a));

  return (
    <section className="card p-6 space-y-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Wallets</h2>
        <p className="text-sm text-muted">Link your EVM and NEAR wallets: signing in with any of them opens this profile.</p>
      </div>
      <ul className="divide-y divide-border">
        {wallets.map((a, i) => (
          <li key={a} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="min-w-0 truncate">
              <span className="text-muted">{walletKind(a)} · </span>{shortAccount(a)}
              {a === accountId && <span className="text-muted"> · signed in</span>}
            </span>
            {i > 0 && (
              <button type="button" className="shrink-0 text-muted hover:text-text disabled:opacity-50" disabled={busy !== null}
                onClick={change(a, (token) => unlinkWallet(token, a))}>
                {busy === a ? "Unlinking…" : "Unlink"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {linkable.map((a) => (
        <div key={a} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{walletKind(a)} · {shortAccount(a)} <span className="text-muted">signed in here before</span></span>
          <button type="button" className="btn btn-primary shrink-0 px-4 py-1.5 text-sm" disabled={busy !== null}
            onClick={change(a, async (token) => {
              const other = demo ? a : savedStaffToken(a);
              if (!other) throw new Error("Sign in with that wallet again to link it.");
              return linkWallet(token, other);
            })}>
            {busy === a ? "Linking…" : "Link"}
          </button>
        </div>
      ))}
      {adding ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Sign in with the other wallet, then press Link here.</p>
          <SignInOptions demo={false} />
        </div>
      ) : !demo && (
        // The token of this wallet stays on the device, so the next wallet can link to it.
        <button type="button" className="btn btn-ghost text-sm" disabled={busy !== null} onClick={run("add", async () => setAdding(true))}>
          {busy === "add" ? "Signing…" : "Link Another Wallet"}
        </button>
      )}
      {error && <p className="text-sm text-warn break-words" role="status">{error}</p>}
    </section>
  );
}

const LINKS: [LinkKind, string, string][] = [
  ["x", "X", "@handle"],
  ["telegram", "Telegram", "@handle"],
  ["instagram", "Instagram", "@handle"],
  ["website", "Website", "https://"],
];

function Editor({ accountId, linkRev }: { accountId: string; linkRev: number }) {
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
  }, [accountId, linkRev]);

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
    <>
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
    </>
  );
}
