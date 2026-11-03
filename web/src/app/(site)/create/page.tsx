"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { events, toUnits } from "@/lib/near";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEvent() {
  const router = useRouter();
  const { accountId, signIn, send } = useWallet();
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    cover_url: "",
    starts_at: "",
    ends_at: "",
    deposit: "10",
    capacity: "50",
    cohosts: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default to tomorrow, on the hour, for two hours (set on the client, not during prerender).
  useEffect(() => {
    const start = new Date(Date.now() + 24 * 3600_000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 2 * 3600_000);
    setForm((f) => ({ ...f, starts_at: f.starts_at || localInput(start), ends_at: f.ends_at || localInput(end) }));
  }, []);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const capacity = Number(form.capacity);
      const storage = BigInt(await events.storageCost(capacity));
      await send([
        {
          receiverId: EVENTS_CONTRACT,
          methodName: "create_event",
          args: {
            metadata: {
              title: form.title.trim(),
              description: form.description.trim(),
              location: form.location.trim(),
              cover_url: form.cover_url.trim() || null,
              starts_at: new Date(form.starts_at).getTime(),
              ends_at: new Date(form.ends_at).getTime(),
            },
            deposit: toUnits(form.deposit),
            capacity,
            cohosts: form.cohosts.split(/[\s,]+/).filter(Boolean),
          },
          deposit: storage,
        },
      ]);
      // The new event is the latest one created by this account.
      const latest = (await events.list()).find((ev) => ev.host === accountId);
      router.push(latest ? `/e/${latest.id}` : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-3xl font-semibold tracking-tight">Host an event</h1>
      <p className="text-muted mt-2">
        Guests commit an equal USDC deposit. Whoever you check in splits the pool. Hosting as a DAO? Create the event
        through a DAO proposal (see README) and add your door person as co-host.
      </p>
      <form onSubmit={submit} className="card p-5 mt-6 space-y-4">
        <Field label="Event name">
          <input className="input text-lg" required maxLength={120} value={form.title} onChange={set("title")} placeholder="NEAR Builders Breakfast" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input className="input" type="datetime-local" required value={form.starts_at} onChange={set("starts_at")} />
          </Field>
          <Field label="Ends">
            <input className="input" type="datetime-local" required value={form.ends_at} onChange={set("ends_at")} />
          </Field>
        </div>
        <Field label="Location">
          <input className="input" maxLength={300} value={form.location} onChange={set("location")} placeholder="Address or link" />
        </Field>
        <Field label="Description">
          <textarea className="input min-h-28" maxLength={2000} value={form.description} onChange={set("description")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deposit (USDC)">
            <input className="input" type="number" min="0.01" step="0.01" required value={form.deposit} onChange={set("deposit")} />
          </Field>
          <Field label="Capacity (max 300)">
            <input className="input" type="number" min="1" max="300" required value={form.capacity} onChange={set("capacity")} />
          </Field>
        </div>
        <Field label="Co-hosts who check guests in (NEAR accounts, comma separated)">
          <input className="input" value={form.cohosts} onChange={set("cohosts")} placeholder="alice.testnet" />
        </Field>
        <Field label="Cover image URL (optional)">
          <input className="input" type="url" maxLength={300} value={form.cover_url} onChange={set("cover_url")} />
        </Field>
        <p className="text-xs text-muted">
          You attach a little NEAR for on-chain storage; whatever is unused comes back when the event closes.
        </p>
        {error && <p className="text-sm text-warn break-words">{error}</p>}
        {accountId ? (
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Confirm in your wallet…" : "Create event"}</button>
        ) : (
          <button type="button" className="btn btn-primary w-full" onClick={signIn}>Sign in to create</button>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
