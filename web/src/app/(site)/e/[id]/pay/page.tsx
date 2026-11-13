"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { events, formatUsdc, isTicket, needsBond, registrationEndsAt, registrationOpen, type EventView } from "@/lib/near";
import { ruleText, type AccessCheck } from "@/lib/access";
import { EVENTS_CONTRACT, NETWORK } from "@/lib/config";
import { useWallet } from "@/lib/wallet";
import {
  confidentialBalance, confirmRegistration, forgetIntentsSession, intentsUsdcBalance, moveFromConfidential,
  registerFromIntents, savedIntentsSession, signInToIntents, withdrawIntentsCall,
} from "@/lib/intents";
import { INTENTS_SESSION_EXPIRED, USDC_ASSET } from "@/lib/oneclickClient";
import { pickUsdc } from "@/lib/nearcomShared";
import type { ConfidentialBalance } from "@/lib/intents";
import { embedReturnPath } from "@/lib/embed";
import { guestNamesApi } from "@/lib/guestNamesClient";
import { shortAccount } from "@/components/ui";
import { PayWithToken } from "@/components/PayWithToken";

function requireDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter your name so the host can find you at the door.");
  if (new TextEncoder().encode(name).length > 80) throw new Error("Name is too long. Shorten it and try again.");
  return name;
}

/**
 * Pays from the guest's NEAR Intents balance. Most of that money (near.com's default) is
 * confidential, so on mainnet the guest first signs in with NEAR Intents (one signature, kept
 * 15 minutes) and sees one total. Enough: we move what's missing to the public balance and
 * register. Not enough: they top up on near.com (same account for the same wallet).
 * We don't run a swap or show deposit addresses on our own site.
 */
export default function TopUpAndRegister() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const { accountId, kind, signIn, send, staffToken, signMessage } = useWallet();
  const [event, setEvent] = useState<EventView | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [available, setAvailable] = useState<bigint | null>(null);
  const [registered, setRegistered] = useState(false);
  // The NEAR Intents sign-in (a 15-minute 1Click session) and the confidential USDC it shows.
  const [session, setSession] = useState<string | null>(null);
  const [confidential, setConfidential] = useState<ConfidentialBalance | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);
  const [stage, setStage] = useState("");
  // The access rule's verdict for this account; registering would refund the payment otherwise.
  const [access, setAccess] = useState<AccessCheck | null>(null);

  useEffect(() => {
    let active = true;
    if (!Number.isSafeInteger(id) || id < 0) { setEvent(null); return; }
    events.get(id).then((value) => { if (active) setEvent(value); })
      .catch(() => { if (active) setLoadError("Could not load this event. Reload to try again."); });
    return () => { active = false; };
  }, [id]);

  // Confidential balances exist on mainnet only; NEAR wallets sign NEP-413, EVM wallets ERC-191.
  const intentsSignIn = NETWORK === "mainnet" && (kind === "evm" || kind === "wallet");
  const nep413 = kind === "wallet" ? signMessage : undefined;

  const dropSession = useCallback(() => {
    if (accountId) forgetIntentsSession(accountId);
    setSession(null);
    setConfidential(null);
  }, [accountId]);

  const refreshBalance = useCallback(() => {
    if (!accountId) return;
    intentsUsdcBalance(accountId).then(setAvailable).catch(() => {});
    const saved = intentsSignIn ? savedIntentsSession(accountId) : null;
    setSession(saved);
    if (!saved) return setConfidential(null);
    confidentialBalance(saved).then(setConfidential).catch((e) => {
      if (e instanceof Error && e.message === INTENTS_SESSION_EXPIRED) dropSession();
    });
  }, [accountId, intentsSignIn, dropSession]);

  useEffect(() => {
    setRegistered(false);
    setAvailable(null);
    setSession(null);
    setConfidential(null);
    setSignInFailed(false);
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
  const deposit = BigInt(event.deposit);
  // One total: public USDC plus, after the NEAR Intents sign-in, confidential USDC.
  const known = available !== null && (!session || confidential !== null);
  const total = (available ?? 0n) + (confidential?.usdc ?? 0n);
  const enough = known && total >= deposit;
  // The public balance falls short and the confidential one is unseen yet: the button signs in first.
  const needsSignIn = intentsSignIn && !session && available !== null && available < deposit;
  const action = `${isTicket(event) ? "Pay" : "Deposit"} with NEAR Intents`;

  // One button: sign in to NEAR Intents if needed (this also reads the balance), move confidential
  // USDC to the public balance if needed, then register. Short of money: the top-up card shows.
  const depositWithIntents = async () => {
    if (!accountId || !canRegister) return;
    setBusy(true);
    setError(null);
    try {
      const name = requireDisplayName(displayName);
      const have = available ?? 0n;
      let token = session;
      let kinds = confidential?.kinds ?? [];
      if (needsSignIn) {
        setStage("Sign in with your wallet…");
        try {
          token = await signInToIntents(accountId, nep413);
          const conf = await confidentialBalance(token);
          setConfidential(conf);
          setSession(token);
          kinds = conf.kinds;
          if (have + conf.usdc < deposit) return; // not enough: the top-up card takes over
        } catch (e) {
          setSignInFailed(true);
          throw e;
        }
      }
      if (token && have < deposit) {
        // The rest is confidential: move it to the public balance the escrow takes it from.
        const from = pickUsdc(kinds, deposit - have, USDC_ASSET);
        if (!from) throw new Error("Your USDC is split across networks. On near.com, swap it into one USDC, then try again.");
        setStage("Moving your USDC: confirm in your wallet…");
        await moveFromConfidential(accountId, token, deposit - have, from, nep413);
      }
      setStage("Confirm your registration in your wallet…");
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
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (message === INTENTS_SESSION_EXPIRED) dropSession();
    } finally {
      refreshBalance();
      setStage("");
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
      </p>
      {!accountId ? (
        <button className="btn btn-primary w-full" onClick={() => void signIn()}>Sign In First</button>
      ) : (
        <div className="card p-4 space-y-3">
          {!needsSignIn && (
            <p>
              {known ? `${formatUsdc(total)} USDC in NEAR Intents.` : "Checking your balance…"}{" "}
              <Link href="/me" className="underline">View or withdraw funds</Link>
            </p>
          )}
          {registered && <p className="text-good">Your place is confirmed.</p>}
          {canRegister && (enough || needsSignIn) && (
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
              <button className="btn btn-primary w-full" disabled={busy} onClick={depositWithIntents}>{busy ? stage || "Confirm in your wallet…" : action}</button>
              {needsSignIn && <p className="text-sm text-muted text-center">One signature checks your NEAR Intents balance, confidential included.</p>}
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
      {accountId && canRegister && known && !enough && (!needsSignIn || signInFailed) && (
        <div className="card p-5">
          {/* Step 1 of 2: any token becomes USDC in the guest's own NEAR Intents account; then the main button registers. */}
          <PayWithToken
            accountId={accountId}
            kind={kind}
            send={send}
            amount={deposit - (available ?? 0n)}
            paymentKey={`near-events:payment:${id}:${accountId}`}
            onFunded={refreshBalance}
          />
        </div>
      )}
      {accountId && canRegister && known && !enough && (!needsSignIn || signInFailed) && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold">Or Top Up on near.com</h2>
          {!!confidential?.others.length && (
            <p className="text-sm">Your NEAR Intents balance also holds {confidential.others.join(", ")}. On near.com, swap enough of it into USDC.</p>
          )}
          <ol className="list-decimal pl-5 space-y-2 text-sm">
            <li>Open near.com and sign in with the same wallet you use here{kind === "evm" ? " (EVM Wallets)" : " (NEAR Wallets)"}. Your account there is <span className="font-mono">{shortAccount(accountId)}</span>.</li>
            <li>Add at least <b>{price}</b> on the NEAR network: deposit USDC, or swap any token you hold into USDC.</li>
            <li>Come back to this tab. Your balance updates, then press {action}.</li>
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
