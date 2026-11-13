"use client";

// One tap on "Deposit with NEAR Intents" (Tickets: "Pay with NEAR Intents") does the whole
// registration; the guest only confirms wallet prompts and the button shows the progress.
// Spec: docs/pay-ux-2026-11-13.md. In order, the tap:
// 1. signs in (options open in the card), then carries on;
// 2. registers from the public NEAR Intents USDC, or (NEAR wallets) from the wallet's USDC;
// 3. on mainnet signs in to NEAR Intents and moves private USDC to the public balance;
// 4. else pays from the wallet with a token we pick (1Click, quote signature checked),
//    waits for the USDC and registers;
// 5. else shows "Send from Another Wallet" (by hand, QR) and near.com top-up.
// A failed swap is refunded by 1Click; a failed registration leaves the USDC with the guest.
import { useCallback, useEffect, useRef, useState } from "react";
import { EVENTS_CONTRACT, HAS_FAUCET, NETWORK, TEST_EVM_FAUCET_LIMIT, USDC_CONTRACT } from "@/lib/config";
import { events, formatUsdc, isTicket, usdc, type EventView } from "@/lib/near";
import {
  confidentialBalance, confirmRegistration, evmChainId, forgetIntentsSession, intentsUsdcBalance, moveFromConfidential,
  registerFromIntents, savedIntentsSession, sendFromEvm, signInToIntents, withdrawIntentsCall, type ConfidentialBalance,
} from "@/lib/intents";
import {
  EVM_CHAIN_IDS, evmDepositTx, INTENTS_SESSION_EXPIRED, oneClickQuote, oneClickTokens, payDepositAddress, submitDeposit,
  USDC_ASSET, waitForSwap, type Quote,
} from "@/lib/oneclickClient";
import type { OneClickToken } from "@/lib/oneclick";
import { pickUsdc } from "@/lib/nearcomShared";
import { walletToken } from "@/lib/walletPay";
import { getProfiles } from "@/lib/profilesClient";
import { displayName as profileName } from "@/lib/profilesShared";
import { guestNamesApi } from "@/lib/guestNamesClient";
import { useWallet } from "@/lib/wallet";
import { SignInOptions } from "@/components/SignIn";
import { AccountQr } from "@/components/Qr";
import { SlCopy } from "@/components/SlUi";

const CHAINS: Record<string, string> = {
  eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche",
  gnosis: "Gnosis", near: "NEAR", sol: "Solana", stellar: "Stellar", btc: "Bitcoin", sui: "Sui", xrp: "XRP Ledger",
  tron: "Tron", ton: "TON", aptos: "Aptos", doge: "Dogecoin", ltc: "Litecoin", zec: "Zcash", cardano: "Cardano",
};
const chainName = (c: string) => CHAINS[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
const COLORS = ["#d61f69", "#ff3d8b", "#ffd23f", "#d2ccff", "#ffb3d2"];
// Mainnet only: the private (confidential) balance and live 1Click deposits.
const LIVE = NETWORK === "mainnet";

type Saved = { quote: Quote; assetId: string; manual: boolean; sent: boolean };

/** Turns errors into the one line the spec allows. */
function friendly(e: unknown, price: string): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/declined|rejected|denied|cancel/i.test(m)) return "Cancelled in wallet. Nothing was sent.";
  if (/refunded/i.test(m)) return "Payment returned to your wallet.";
  if (/1Click status/i.test(m)) return "Payment didn't go through. It goes back to your wallet.";
  if (/full|capacity|No spots/i.test(m)) return `The last spot just went. Your ${price} stays in NEAR Intents.`;
  if (/fetch|network|timeout|Failed to/i.test(m)) return "Couldn't reach NEAR. Try again.";
  return m;
}

export function OneTapCheckout({ event, onRegistered }: { event: EventView; onRegistered: () => Promise<void> }) {
  const { accountId, kind, send, staffToken, signMessage } = useWallet();
  const ticket = isTicket(event);
  const deposit = BigInt(event.deposit);
  const price = `${formatUsdc(event.deposit)} USDC`;
  const action = `${ticket ? "Pay" : "Deposit"} with NEAR Intents`;
  const storeKey = `near-me:payment:${event.id}:${accountId ?? ""}`;
  // NEAR wallets sign NEP-413 for NEAR Intents; EVM wallets ERC-191.
  const nep413 = kind === "wallet" ? signMessage : undefined;
  const intentsCapable = LIVE && (kind === "evm" || kind === "wallet");

  const [label, setLabel] = useState<string | null>(null);
  const [fill, setFill] = useState(0);
  const [fillMs, setFillMs] = useState(300);
  const [deadline, setDeadline] = useState<{ at: number; minutes: boolean } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [knownName, setKnownName] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [pick, setPick] = useState<{ token: OneClickToken; quote: Quote | null } | null>(null);
  const [choosing, setChoosing] = useState<"wallet" | "manual" | null>(null);
  const [noFunds, setNoFunds] = useState(false);
  const [manual, setManual] = useState<{ token: OneClickToken; quote: Quote } | null>(null);
  const [confidential, setConfidential] = useState<ConfidentialBalance | null>(null);
  const [publicUsdc, setPublicUsdc] = useState<bigint | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const afterSignIn = useRef(false);
  const busy = label !== null;

  const step = (text: string, to: number, ms = 300) => {
    setLabel(text);
    setFillMs(ms);
    setFill(to);
  };
  const idle = () => {
    setLabel(null);
    setFill(0);
    setFillMs(300);
    setDeadline(null);
  };

  // The guest's name for the host's list: from the profile, asked only when unknown.
  useEffect(() => {
    setKnownName(undefined);
    if (!accountId) return;
    let live = true;
    getProfiles([accountId]).then((p) => live && setKnownName(profileName(p[accountId]))).catch(() => live && setKnownName(null));
    return () => { live = false; };
  }, [accountId]);

  useEffect(() => {
    oneClickTokens().then(setTokens).catch(() => {});
  }, []);

  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadline]);

  const save = (s: Saved | null) => {
    try {
      if (s) localStorage.setItem(storeKey, JSON.stringify(s));
      else localStorage.removeItem(storeKey);
    } catch { /* Optional: a reload then starts over. */ }
  };

  const celebrate = async () => {
    step("Registering", 1, 200);
    try {
      const r = button.current?.getBoundingClientRect();
      const confetti = (await import("canvas-confetti")).default;
      await confetti({
        particleCount: 90, spread: 70, startVelocity: 32, colors: COLORS, disableForReducedMotion: true,
        origin: r ? { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight } : undefined,
      });
    } catch { /* Confetti is a nicety. */ }
  };

  const guestName = (): string | null => {
    const n = (knownName ?? name).trim().replace(/\s+/g, " ");
    if (n) return n.slice(0, 80);
    nameInput.current?.focus();
    setError("Enter your name for the guest list.");
    return null;
  };

  /** Registers from the public NEAR Intents USDC (or, `fromWallet`, the NEAR wallet's own USDC). */
  const register = async (who: string, fromWallet = false) => {
    if (!accountId) return;
    step("Confirm in Wallet", 0.9);
    if (kind === "evm") {
      await registerFromIntents(accountId, event.id, event.deposit, who);
    } else if (fromWallet) {
      await send([{
        receiverId: USDC_CONTRACT, methodName: "ft_transfer_call",
        args: { receiver_id: EVENTS_CONTRACT, amount: event.deposit, msg: JSON.stringify({ action: "register", event_id: event.id }) },
        deposit: 1n,
      }]);
    } else {
      await send([withdrawIntentsCall(EVENTS_CONTRACT, event.deposit, JSON.stringify({ action: "register", event_id: event.id, guest: accountId }))]);
    }
    step("Registering", 0.95);
    await confirmRegistration(event.id, accountId);
    // EVM guests' names ride with the signed registration; others save it with the sign-in token.
    if (kind !== "evm") await staffToken().then((t) => guestNamesApi.save(event.id, who, t)).catch(() => {});
    save(null);
    await celebrate();
    await onRegistered();
  };

  /** Follows a 1Click payment until the USDC is in the guest's NEAR Intents account. */
  const waitPaid = async (quote: Quote, manual: boolean) => {
    const seconds = Math.max(10, quote.timeEstimate ?? 60);
    if (manual) {
      const end = quote.deadline ? Date.parse(quote.deadline) : Date.now() + 30 * 60_000;
      setDeadline({ at: end, minutes: true });
      step("Waiting for Payment", 0.1);
    } else {
      setDeadline({ at: Date.now() + seconds * 1000, minutes: false });
      step("Paying", 0.85, seconds * 1000);
    }
    await waitForSwap(quote.depositAddress!, (s) => {
      if (manual && s !== "PENDING_DEPOSIT") {
        setDeadline({ at: Date.now() + seconds * 1000, minutes: false });
        step("Paying", 0.85, seconds * 1000);
      }
    }, { memo: quote.depositMemo, timeoutMs: manual ? 60 * 60_000 : 15 * 60_000 });
    setDeadline(null);
    // The swap landed: wait until the public balance shows it.
    for (let i = 0; i < 10 && (await intentsUsdcBalance(accountId!).catch(() => 0n)) < deposit; i++) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  /** A fresh 1Click quote that delivers the missing USDC to the guest's own NEAR Intents account. */
  const quoteFor = (token: OneClickToken, need: bigint, refundToIntents: boolean, dry = false) =>
    oneClickQuote({
      dry: dry || !LIVE, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
      originAsset: token.assetId, destinationAsset: USDC_ASSET, amount: need.toString(),
      depositType: "ORIGIN_CHAIN", recipient: accountId, recipientType: "INTENTS",
      // Sent from this wallet: a refund goes back to it. By hand: to the guest's own Intents account.
      refundTo: accountId, refundType: refundToIntents ? "INTENTS" : "ORIGIN_CHAIN",
    });

  const payFromWallet = async (token: OneClickToken, need: bigint, who: string) => {
    step("Confirm in Wallet", 0.15);
    const quote = await quoteFor(token, need, false);
    if (!quote.depositAddress) throw new Error("Payments from the wallet run on mainnet only.");
    save({ quote, assetId: token.assetId, manual: false, sent: false });
    if (kind === "evm") {
      const hash = await sendFromEvm(EVM_CHAIN_IDS[token.blockchain], evmDepositTx(accountId!, token, quote.depositAddress, quote.amountIn));
      submitDeposit(quote.depositAddress, hash);
    } else {
      // Native NEAR is wrapped first, then sent as wNEAR.
      await send([
        { receiverId: "wrap.near", methodName: "near_deposit", args: {}, deposit: BigInt(quote.amountIn), gas: 10_000_000_000_000n },
        ...payDepositAddress("wrap.near", quote.depositAddress, quote.amountIn),
      ]);
    }
    save({ quote, assetId: token.assetId, manual: false, sent: true });
    await waitPaid(quote, false);
    await register(who);
  };

  const go = useCallback(async () => {
    if (busy) return;
    setError(null);
    if (!accountId) {
      afterSignIn.current = true;
      setSigningIn(true);
      return;
    }
    const who = guestName();
    if (!who) return;
    setNoFunds(false);
    try {
      step("Checking", 0.05);
      const pub = await intentsUsdcBalance(accountId);
      setPublicUsdc(pub);
      if (pub >= deposit) return await register(who);
      // NEAR wallets and Google/email: USDC in the wallet itself pays in one transaction.
      if (kind !== "evm" && BigInt(await usdc.balance(accountId).catch(() => "0")) >= deposit) return await register(who, true);
      if (HAS_FAUCET) {
        // Testnet: free test USDC (into NEAR Intents for EVM wallets, into the wallet otherwise).
        if (deposit > TEST_EVM_FAUCET_LIMIT) throw new Error(`You need ${price} to register.`);
        step("Getting test USDC", 0.4);
        const r = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ accountId }) });
        if (!r.ok) throw new Error((await r.json()).error ?? "Could not get test USDC");
        return await register(who, kind !== "evm");
      }
      let session = intentsCapable ? savedIntentsSession(accountId) : null;
      let conf = session ? confidential : null;
      if (intentsCapable && !session) {
        step("Confirm in Wallet", 0.1);
        session = await signInToIntents(accountId, nep413);
      }
      if (session && !conf) {
        conf = await confidentialBalance(session);
        setConfidential(conf);
      }
      if (session && conf && pub + conf.usdc >= deposit) {
        const from = pickUsdc(conf.kinds, deposit - pub, USDC_ASSET);
        if (!from) throw new Error("Your USDC is split across networks. On near.com, swap it into one USDC, then try again.");
        step("Confirm in Wallet", 0.4);
        await moveFromConfidential(accountId, session, deposit - pub, from, nep413);
        return await register(who);
      }
      const need = deposit - pub;
      step("Checking", 0.1);
      const token = pick?.token ?? (await walletToken(kind, accountId, need, tokens.length ? tokens : await oneClickTokens(), kind === "evm" ? await evmChainId() : null));
      if (!token) {
        setNoFunds(true);
        return idle();
      }
      if (!pick) setPick({ token, quote: null });
      await payFromWallet(token, need, who);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === INTENTS_SESSION_EXPIRED) forgetIntentsSession(accountId);
      setError(friendly(e, price));
      idle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, accountId, kind, knownName, name, pick, tokens, confidential, deposit]);

  // After the sign-in options, the flow carries on by itself.
  useEffect(() => {
    if (accountId && afterSignIn.current && knownName !== undefined) {
      afterSignIn.current = false;
      setSigningIn(false);
      void go();
    }
  }, [accountId, knownName, go]);

  // A reload while a payment is on its way picks it up again.
  useEffect(() => {
    if (!accountId) return;
    let saved: Saved | null = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey) ?? "null"); } catch {}
    if (!saved?.quote?.depositAddress || (!saved.sent && !saved.manual)) return;
    const s = saved;
    const token = tokens.find((t) => t.assetId === s.assetId);
    if (s.manual && token) setManual({ token, quote: s.quote });
    (async () => {
      try {
        await waitPaid(s.quote, s.manual);
        const who = (knownName ?? name).trim();
        if (who) await register(who);
        else { idle(); setError("Your USDC arrived. Enter your name, then tap the button."); }
      } catch (e) {
        save(null);
        setError(friendly(e, price));
        idle();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, storeKey, tokens.length > 0, knownName !== undefined]);

  // Balances known without a prompt: the public one, and the private one while a NEAR Intents session lasts.
  useEffect(() => {
    setPublicUsdc(null);
    setConfidential(null);
    setPick(null);
    setNoFunds(false);
    if (!accountId) return;
    let live = true;
    intentsUsdcBalance(accountId).then((b) => live && setPublicUsdc(b)).catch(() => {});
    const session = intentsCapable ? savedIntentsSession(accountId) : null;
    if (session) confidentialBalance(session).then((c) => live && setConfidential(c)).catch(() => {});
    return () => { live = false; };
  }, [accountId, intentsCapable]);

  // Before the tap, show which wallet token would pay, once we know the balances fall short.
  useEffect(() => {
    if (!accountId || busy || pick || !tokens.length || HAS_FAUCET) return;
    const short = publicUsdc !== null && publicUsdc + (confidential?.usdc ?? 0n) < deposit;
    if (!short || (intentsCapable && !confidential)) return;
    let live = true;
    (async () => {
      // A NEAR wallet with USDC of its own pays from it in one transaction: nothing to pick.
      if (kind !== "evm" && BigInt(await usdc.balance(accountId).catch(() => "0")) >= deposit) return;
      const need = deposit - publicUsdc!;
      const token = await walletToken(kind, accountId, need, tokens, kind === "evm" ? await evmChainId() : null);
      if (!live) return;
      if (!token) return setNoFunds(true);
      const quote = await quoteFor(token, need, false, true).catch(() => null);
      if (live) setPick({ token, quote });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, kind, publicUsdc, confidential, tokens.length]);

  const startManual = async (token?: OneClickToken) => {
    const t = token ?? tokens.find((x) => x.symbol === "USDC" && x.blockchain === "base") ?? tokens[0];
    if (!t || !accountId) return;
    setError(null);
    setChoosing(null);
    try {
      step("Checking", 0.05);
      const need = deposit - (publicUsdc ?? (await intentsUsdcBalance(accountId)));
      const quote = await quoteFor(t, need, true);
      if (!quote.depositAddress) throw new Error("Payments by hand run on mainnet only.");
      setManual({ token: t, quote });
      save({ quote, assetId: t.assetId, manual: true, sent: false });
      await waitPaid(quote, true);
      const who = guestName();
      if (who) await register(who);
      else idle();
    } catch (e) {
      setError(friendly(e, price));
      idle();
    }
  };

  const remaining = deadline ? Math.max(0, Math.ceil((deadline.at - now) / 1000)) : 0;
  const shown = label === "Paying" ? `Paying · ${remaining} s`
    : label === "Waiting for Payment" ? `Waiting for Payment · ${Math.max(1, Math.ceil(remaining / 60))} min`
      : label ?? (error ? "Try Again" : manual ? "Waiting for Payment" : action);

  if (signingIn && !accountId) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium">How do you want to sign in?</div>
        <SignInOptions onDone={() => {}} />
        <button className="w-full text-xs text-muted pt-1" onClick={() => { afterSignIn.current = false; setSigningIn(false); }}>Back</button>
      </div>
    );
  }

  // From this wallet: only what it can send itself. By hand: anything 1Click takes.
  const sendable = (t: OneClickToken) => (kind === "evm" ? !!EVM_CHAIN_IDS[t.blockchain] : t.assetId === "nep141:wrap.near");
  const tokenList = (onPick: (t: OneClickToken) => void, fromWallet: boolean) => (
    <select className="input" aria-label="Pay with" defaultValue="" onChange={(e) => { const t = tokens.find((x) => x.assetId === e.target.value); if (t) onPick(t); }}>
      <option value="" disabled>Pick a token</option>
      {tokens.filter((t) => t.assetId !== USDC_ASSET && (!fromWallet || sendable(t))).sort((a, b) => a.symbol.localeCompare(b.symbol) || a.blockchain.localeCompare(b.blockchain))
        .map((t) => <option key={t.assetId} value={t.assetId}>{t.symbol} on {chainName(t.blockchain)}</option>)}
    </select>
  );

  return (
    <div className="space-y-3">
      {accountId && knownName === null && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">Your name</span>
          <input ref={nameInput} className="input w-full" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Name for the guest list" autoComplete="name" maxLength={80} disabled={busy} />
        </label>
      )}

      {manual?.quote.depositAddress ? (
        <div className="space-y-3">
          <p className="text-sm">
            Send <b className="whitespace-nowrap">{manual.quote.amountInFormatted} {manual.token.symbol}</b> on {chainName(manual.token.blockchain)} ·{" "}
            <button type="button" className="text-accent" disabled={busy && label !== "Waiting for Payment"} onClick={() => { idle(); save(null); setManual(null); setChoosing("manual"); }}>Change</button>
          </p>
          <div className="flex gap-4 items-start">
            <AccountQr account={manual.quote.depositAddress} size={120} />
            <div className="min-w-0 space-y-2 text-sm">
              <div className="flex items-start gap-1"><span className="font-mono break-all">{manual.quote.depositAddress}</span><SlCopy text={manual.quote.depositAddress} /></div>
              {manual.quote.depositMemo && (
                <div className="flex items-center gap-1">Memo <span className="font-mono">{manual.quote.depositMemo}</span><SlCopy text={manual.quote.depositMemo} /></div>
              )}
              {manual.quote.depositMemo && <p className="text-warn">Include the memo.</p>}
              <p className="text-muted">Signed by NEAR Intents</p>
            </div>
          </div>
        </div>
      ) : choosing === "manual" ? (
        tokenList((t) => void startManual(t), false)
      ) : null}

      {error && <p className="text-sm text-warn break-words">{error}</p>}

      {noFunds && !manual && !busy ? (
        <div className="space-y-2">
          <p className="text-sm">Add {price} to register.</p>
          <button className="btn btn-accent w-full !py-3.5" onClick={() => setChoosing("manual")}>Send from Another Wallet</button>
          <a className="block text-center text-sm text-accent" href="https://near.com" target="_blank" rel="noopener noreferrer">Or top up on near.com ↗</a>
        </div>
      ) : !(choosing === "manual" && !manual) && (
        <button ref={button} type="button" aria-busy={busy}
          className={`btn btn-accent w-full !py-3.5 gc-progress${busy ? " is-busy" : ""}`}
          onClick={busy || manual ? undefined : () => void go()}>
          <span className="gc-progress-fill" style={{ transform: `scaleX(${fill})`, transitionDuration: `${fillMs}ms`, transitionTimingFunction: fillMs > 1000 ? "linear" : undefined }} />
          <span key={shown.split(" · ")[0]} className="gc-progress-label">{shown}</span>
        </button>
      )}

      {pick && !busy && !manual && !noFunds && (
        choosing === "wallet" ? tokenList((t) => {
          setChoosing(null);
          setPick({ token: t, quote: null });
          const need = deposit - (publicUsdc ?? 0n);
          quoteFor(t, need, false, true).then((quote) => setPick({ token: t, quote })).catch(() => {});
        }, true)
          : (
            <p className="text-sm text-muted text-center">
              {pick.quote ? `${pick.quote.amountInFormatted} ` : ""}{pick.token.symbol} from your wallet · {chainName(pick.token.blockchain)} ·{" "}
              <button type="button" className="text-accent" onClick={() => setChoosing("wallet")}>Change</button>
            </p>
          )
      )}
    </div>
  );
}
