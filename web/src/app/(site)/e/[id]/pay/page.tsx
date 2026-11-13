"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, isTicket, needsBond, registrationEndsAt, registrationOpen, type EventView } from "@/lib/near";
import { ruleText, type AccessCheck } from "@/lib/access";
import { EVENTS_CONTRACT } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import { confirmRegistration, intentsUsdcBalance, registerFromIntents, withdrawIntentsCall } from "@/lib/intents";
import { embedReturnPath } from "@/lib/embed";
import { guestNamesApi } from "@/lib/guestNamesClient";
import { shortAccount } from "@/components/ui";

function requireDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter your name so the host can find you at the door.");
  if (new TextEncoder().encode(name).length > 80) throw new Error("Name is too long. Shorten it and try again.");
  return name;
}

/**
 * Not enough USDC to register: the guest tops up their NEAR Intents account on near.com,
 * the official NEAR app (same account for the same wallet), then confirms here.
 * We don't run a swap or show deposit addresses on our own site.
 */
export default function TopUpAndRegister() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { accountId, kind, signIn, send, staffToken } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [available, setAvailable] = useState<bigint | null>(null);
  const [registered, setRegistered] = useState(false);
  // The access rule's verdict for this account; registering would refund the payment otherwise.
  const [access, setAccess] = useState<AccessCheck | null>(null);

  useEffect(() => {
    let active = true;
    if (!Number.isSafeInteger(id) || id < 0) { setEvent(null); return; }
    events.get(id).then((value) => { if (active) setEvent(value); })
      .catch(() => { if (active) setLoadError("Could not load this event. Reload to try again."); });
    return () => { active = false; };
  }, [id]);

  const refreshBalance = useCallback(() => {
    if (accountId) intentsUsdcBalance(accountId).then(setAvailable).catch(() => {});
  }, [accountId]);

  useEffect(() => {
    setRegistered(false);
    setAvailable(null);
    setAccess(null);
    if (!accountId) return;
    let active = true;
    events.checkAccess(id, accountId).then((check) => { if (active) setAccess(check); }).catch(() => {});
    refreshBalance();
    events.guestStatus(id, accountId).then((state) => {
      if (!active) return;
      setRegistered(!!state);
      const returnPath = state && embedReturnPath(new URLSearchParams(window.location.search).get("returnTo"), id);
      if (returnPath) router.replace(returnPath);
    }).catch(() => {});
    // Coming back from the near.com tab re-reads the balance.
    window.addEventListener("focus", refreshBalance);
    return () => { active = false; window.removeEventListener("focus", refreshBalance); };
  }, [accountId, id, router, refreshBalance]);

  if (loadError) return <p className="text-warn">{loadError}</p>;
  if (event === undefined) return <p className="text-muted">Loading…</p>;
  if (!event) return <p>Event not found.</p>;
  const notAllowed = !!event.access && access?.allowed === false;
  // A Deposit event takes guests only after the host bond (escrow v3): no payment into a refused seat.
  const canRegister = event.status === "Open" && event.guest_count < event.capacity && Date.now() < registrationEndsAt(event) && !registered && !notAllowed && !needsBond(event);
  const price = `${formatUsdc(event.deposit)} USDC`;
  const enough = available !== null && available >= BigInt(event.deposit);

  const finishRegistration = async () => {
    if (!accountId || !canRegister) return;
    setBusy(true);
    setError(null);
    try {
      const name = requireDisplayName(displayName);
      if (kind === "evm") {
        await registerFromIntents(accountId, event.id, event.deposit, name);
      } else {
        const msg = JSON.stringify({ action: "register", event_id: event.id, guest: accountId });
        await send([withdrawIntentsCall(EVENTS_CONTRACT, event.deposit, msg)]);
      }
      await confirmRegistration(event.id, accountId);
      // EVM guests: the server already saved the name with the signed registration.
      if (kind !== "evm") try {
        const token = await staffToken();
        await guestNamesApi.save(event.id, name, token);
      } catch {
        // Registration already landed on-chain; name is best-effort for the host list.
      }
      setRegistered(true);
      const returnPath = embedReturnPath(new URLSearchParams(window.location.search).get("returnTo"), event.id);
      if (returnPath) router.replace(returnPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      refreshBalance();
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Link href={`/e/${id}`} className="text-muted hover:text-text">← {event.metadata.title}</Link>
      <h1 className="gc-page-title">Save your place.</h1>
      {event.access && <p className={notAllowed ? "text-warn" : "text-muted"}>{notAllowed ? `You can't register yet. ${ruleText(event.access)}` : ruleText(event.access)}</p>}
      <p className="text-muted">
        Your {isTicket(event) ? "ticket" : "deposit"} of <b className="text-text">{price}</b> is paid from your NEAR Intents balance.
        Top it up on near.com, the official NEAR app, then confirm here.
      </p>
      {!accountId ? (
        <button className="btn btn-primary w-full" onClick={() => void signIn()}>Sign In First</button>
      ) : (
        <div className="card p-4 space-y-3">
          <p>
            {available === null ? "Checking your balance…" : `${formatUsdc(available)} USDC in NEAR Intents.`}{" "}
            <Link href="/me" className="underline">View or withdraw funds</Link>
          </p>
          {registered && <p className="text-good">Your place is confirmed.</p>}
          {canRegister && enough && (
            <>
              <label className="block space-y-1">
                <span className="text-sm font-medium">Your name</span>
                <input
                  className="input w-full"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Name for the guest list"
                  autoComplete="name"
                  maxLength={80}
                  disabled={busy}
                />
              </label>
              <button className="btn btn-primary" disabled={busy} onClick={finishRegistration}>{busy ? "Confirm in your wallet…" : "Confirm Registration"}</button>
            </>
          )}
          {!canRegister && !registered && (
            needsBond(event) ? <p>Registration opens once the host locks the bond.</p>
              : registrationOpen(event) && event.guest_count >= event.capacity ? <p>This event is full.</p>
                : !registrationOpen(event) ? <p>Registration is closed.</p>
                  : null // the access rule refused: said above
          )}
          {error && <p className="text-sm text-warn break-words">{error}</p>}
        </div>
      )}
      {accountId && canRegister && available !== null && !enough && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold">Top up on near.com</h2>
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Open near.com and sign in with the same wallet you use here{kind === "evm" ? " (EVM Wallets)" : " (NEAR Wallets)"}. Your account there is <span className="font-mono">{shortAccount(accountId)}</span>.</li>
            <li>Add at least <b>{price}</b> on the NEAR network: deposit USDC, or swap any token you hold into USDC.</li>
            <li>Come back to this tab. Your balance updates, then press Confirm Registration.</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <a href="https://near.com/login" target="_blank" rel="noopener noreferrer" className="btn btn-accent">Open near.com ↗</a>
            <button type="button" className="btn btn-ghost" onClick={refreshBalance}>Check Balance</button>
          </div>
        </div>
      )}
    </div>
  );
}
