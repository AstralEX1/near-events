"use client";

import { useState } from "react";
import { formatUsdc, toUnits, usdc, type EventView } from "@/lib/near";
import { EVENTS_CONTRACT, HAS_FAUCET, USDC_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

/**
 * Anyone can top up the pool (Kickback's "Contribute"): the bonus is split
 * between the people who come. If the event is cancelled it goes to the host.
 */
export function SponsorButton({ event, onDone }: { event: EventView; onDone: () => Promise<void> }) {
  const { accountId, kind, send, signIn } = useWallet();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (event.status !== "Open") return null;

  const contribute = async () => {
    setBusy(true);
    setError(null);
    try {
      const units = toUnits(amount);
      if (BigInt(units) <= 0n) throw new Error("Enter an amount");
      const have = BigInt(await usdc.balance(accountId!));
      if (have < BigInt(units)) {
        if (!HAS_FAUCET) throw new Error(`You need ${amount} USDC on NEAR`);
        const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId, amount: (BigInt(units) - have).toString() }) });
        if (!r.ok) throw new Error((await r.json()).error ?? "Faucet failed");
      }
      await send([
        {
          receiverId: USDC_CONTRACT,
          methodName: "ft_transfer_call",
          args: { receiver_id: EVENTS_CONTRACT, amount: units, msg: JSON.stringify({ action: "sponsor", event_id: event.id }) },
          deposit: 1n,
        },
      ]);
      setOpen(false);
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <button className="text-sm text-accent hover:underline underline-offset-2" onClick={() => setOpen(true)}>
        + Sponsor this event
      </button>
    );

  return (
    <div className="card p-4 space-y-3">
      <div>
        <div className="font-semibold">How much would you like to add to the pool?</div>
        <p className="text-sm text-muted mt-1">
          Your bonus is split between everyone who shows up, on top of their deposits. Pool now:{" "}
          {formatUsdc(event.total_pool)} USDC. If the event is cancelled, the bonus goes to the host.
        </p>
      </div>
      {!accountId ? (
        <button className="btn btn-primary w-full" onClick={signIn}>Sign in to sponsor</button>
      ) : kind === "evm" ? (
        <p className="text-sm text-muted">Sponsoring from an EVM wallet isn’t supported yet. Use a NEAR wallet or Google sign-in.</p>
      ) : (
        <div className="flex gap-2">
          <input className="input" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn btn-accent whitespace-nowrap" disabled={busy} onClick={contribute}>
            {busy ? "Confirm…" : `Add ${amount || 0} USDC`}
          </button>
        </div>
      )}
      {error && <p className="text-sm text-warn break-words">{error}</p>}
      <button className="text-xs text-muted" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}
