"use client";

// "Select Token" for paying and for cash-outs: search, a row of network shortcuts with
// a "More" menu, and one list grouped by section. Copied from the Aurora Intents Swap
// Widget's TokensModal / ChainsSelector / ChainsDropdown / TokenItem
// (github.com/aurora-is-near/intents-swap-widget, MIT, Copyright (c) 2025 Aurora Labs Limited),
// restyled with the app's tokens.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { OneClickToken } from "@/lib/oneclick";
import { chainIcon, chainName, INTENTS_TOKEN, tokenIcon } from "@/lib/tokenCatalog";
import { Icon } from "@/components/EventSections";

const ALL = "all";
// Lucide paths (ISC).
const SEARCH = ["m21 21-4.34-4.34", "M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16"];
const CHEVRON = ["m6 9 6 6 6-6"];
const CHECK = ["M20 6 9 17l-5-5"];
const CLOSE = ["M18 6 6 18", "m6 6 12 12"];
// Aurora's default shortcuts are eth, btc, sol, near; a few more fill in when some are missing.
const TOP = ["eth", "btc", "sol", "near", "base", "arb", "bsc", "pol"];
// The coins people look for first, before the rest by name.
const POPULAR = ["USDC", "USDT", "ETH", "BTC", "NEAR", "SOL"];

/** A balance for a list: up to 6 significant digits, never in exponent form (NearJar's amountText). */
export function amountText(amount: bigint, decimals: number, significant = 6): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fracDigits = (amount % base).toString().padStart(decimals, "0");
  const lead = fracDigits.length - fracDigits.replace(/^0+/, "").length;
  const keep = Math.max(0, Math.min(decimals, whole > 0n ? significant - whole.toString().length : significant + lead));
  const f = fracDigits.slice(0, keep).replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}

const usdOf = (t: OneClickToken, amount: bigint) => (t.price ? (Number(amount) / 10 ** t.decimals) * t.price : null);
const money = (v: number) => `$${v < 0.01 && v > 0 ? "<0.01" : v.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const popular = (s: string) => (POPULAR.indexOf(s.toUpperCase()) + 1 || 99);

function NetworkIcon({ chain, size = 20 }: { chain: string; size?: number }) {
  const src = chainIcon(chain);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-md" />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-md bg-border text-[8px] font-semibold text-muted" style={{ width: size, height: size }}>
      {chainName(chain).slice(0, 3).toUpperCase()}
    </span>
  );
}

// Aurora's AllNetworksIcon: four small squares.
const AllIcon = () => (
  <span className="grid shrink-0 grid-cols-2 gap-[2px]" aria-hidden>
    {[0.9, 0.45, 0.45, 0.9].map((o, i) => <span key={i} className="size-[7px] rounded-[2px] bg-current" style={{ opacity: o }} />)}
  </span>
);

export function TokenIcon({ token, size = 28, badge = false }: { token: OneClickToken; size?: number; badge?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = tokenIcon(token);
  const chain = chainIcon(token.blockchain);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="rounded-full" onError={() => setBroken(true)} />
      ) : (
        <span className="grid place-items-center rounded-full bg-border text-[10px] font-semibold text-muted" style={{ width: size, height: size }}>
          {token.symbol.slice(0, 3)}
        </span>
      )}
      {badge && chain && (
        <span className="absolute -right-1 grid size-4 place-items-center overflow-hidden rounded-[4px] border-2 border-[var(--surface)] bg-[var(--surface)]" style={{ top: size - 9 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={chain} alt="" width={16} height={16} />
        </span>
      )}
    </span>
  );
}

/** The closed picker in a form: the chosen token and a chevron (Aurora's TokenSelectButton). */
export function TokenButton({ token, onClick, disabled }: { token?: OneClickToken; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="input flex w-full items-center gap-3 text-left" onClick={onClick} disabled={disabled}>
      {token ? <TokenIcon token={token} badge /> : <span className="size-7 shrink-0 rounded-full bg-border" />}
      <span className="min-w-0 flex-1 truncate">
        {token ? <><b className="font-medium">{token.symbol}</b> <span className="text-muted">on {chainName(token.blockchain)}</span></> : <span className="text-muted">Select Token</span>}
      </span>
      <span className="text-muted"><Icon paths={CHEVRON} size={18} /></span>
    </button>
  );
}

export function TokenPicker({ tokens, balances, selected, hint, intents = false, onPick, onClose }: {
  tokens: OneClickToken[];
  /** Held amounts by asset id; empty when there is nothing to show. */
  balances?: Map<string, bigint>;
  selected?: string;
  hint?: string;
  /** Cash-out: offer keeping the USDC in a NEAR Intents account (INTENTS_TOKEN). */
  intents?: boolean;
  onPick: (t: OneClickToken) => void;
  onClose: () => void;
}) {
  const held = useMemo(() => balances ?? new Map<string, bigint>(), [balances]);
  const amountOf = (t: OneClickToken) => held.get(t.assetId) ?? 0n;
  const [q, setQ] = useState("");
  const [net, setNet] = useState<string>(() => (selected === INTENTS_TOKEN.assetId ? "intents" : ALL));
  const [more, setMore] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // Escape clears the search first, then closes (Aurora).
  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (more) setMore(false);
      else if (search.current?.value) setQ("");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, more]);

  useEffect(() => {
    if (!more) return;
    const away = (e: PointerEvent) => !menu.current?.contains(e.target as Node) && setMore(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [more]);

  // Networks: those with a balance first (by USD), then by name.
  const networks = useMemo(() => {
    const usd = new Map<string, number>();
    for (const t of tokens) {
      const a = held.get(t.assetId) ?? 0n;
      usd.set(t.blockchain, (usd.get(t.blockchain) ?? 0) + (a > 0n ? usdOf(t, a) ?? 1e-9 : 0));
    }
    return [...usd.keys()].sort((a, b) => usd.get(b)! - usd.get(a)! || chainName(a).localeCompare(chainName(b)));
  }, [tokens, held]);

  const top = useMemo(() => {
    const withBalance = networks.filter((c) => tokens.some((t) => t.blockchain === c && amountOf(t) > 0n));
    const list = [...new Set([...withBalance, ...TOP])].filter((c) => networks.includes(c)).slice(0, 4);
    // The last shortcut is kept for a network picked from "More" (Aurora).
    if (net !== ALL && net !== "intents" && !list.includes(net)) list[Math.max(0, list.length - 1)] = net;
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networks, net]);

  const needle = q.trim().toLowerCase();
  const matches = (t: OneClickToken) =>
    !needle || t.symbol.toLowerCase().includes(needle) || chainName(t.blockchain).toLowerCase().includes(needle)
    || (needle.length > 6 && (t.contractAddress?.toLowerCase() === needle || t.assetId.toLowerCase().includes(needle)));

  const groups = useMemo(() => {
    const value = (t: OneClickToken) => usdOf(t, amountOf(t)) ?? 0;
    const list = (net === "intents" ? [] : tokens)
      .filter((t) => (net === ALL || t.blockchain === net) && matches(t))
      .sort((a, b) => value(b) - value(a) || popular(a.symbol) - popular(b.symbol) || a.symbol.localeCompare(b.symbol) || chainName(a.blockchain).localeCompare(chainName(b.blockchain)));
    const mine = list.filter((t) => amountOf(t) > 0n);
    const rest = list.filter((t) => amountOf(t) === 0n);
    const keep = intents && (net === ALL || net === "intents") && matches(INTENTS_TOKEN) ? [INTENTS_TOKEN] : [];
    return [
      { label: "NEAR Intents", tokens: keep },
      { label: "Your tokens", tokens: mine },
      { label: "All tokens", tokens: rest },
    ].filter((g) => g.tokens.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, held, net, needle, intents]);

  const chip = (on: boolean) => `flex h-9 shrink-0 cursor-pointer items-center rounded-xl transition-colors ${on ? "bg-text text-bg" : "bg-text/6 hover:bg-text/10"}`;
  const choose = (c: string) => { setNet(c); setMore(false); };
  const menuItem = (c: string, label: string, icon: ReactNode) => (
    <button key={c} type="button" onClick={() => choose(c)}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-sm transition-colors ${net === c ? "bg-text/6" : "hover:bg-text/6"}`}>
      {icon}
      <span className="mr-auto truncate">{label}</span>
      {net === c && <span className="text-good"><Icon paths={CHECK} size={16} /></span>}
    </button>
  );

  return (
    <div className="gc-sheet-backdrop" onClick={onClose}>
      <div className="gc-sheet" style={{ width: "min(440px, 100%)" }} role="dialog" aria-modal="true" aria-label="Select Token" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-4 px-5 pt-5">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Select Token</h2>
            <button type="button" aria-label="Close" className="-mr-1.5 grid size-8 place-items-center rounded-full text-muted hover:bg-text/6" onClick={onClose}>
              <Icon paths={CLOSE} size={18} />
            </button>
          </header>

          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"><Icon paths={SEARCH} size={18} /></span>
            <input ref={search} className="input w-full !pl-10" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search or paste address" aria-label="Search tokens, networks or addresses" />
          </div>

          <div className="flex items-start justify-between gap-2" role="tablist" aria-label="Networks">
            <button type="button" role="tab" aria-selected={net === ALL} className={`${chip(net === ALL)} gap-2 px-3 text-sm font-medium`} onClick={() => choose(ALL)}>
              <AllIcon />All
            </button>
            <div className="mr-auto flex h-9 flex-wrap items-center gap-2 overflow-hidden">
              {intents && (
                <button type="button" role="tab" aria-selected={net === "intents"} aria-label="NEAR Intents" data-tooltip="NEAR Intents"
                  className={`${chip(net === "intents")} w-9 justify-center`} onClick={() => choose("intents")}>
                  <NetworkIcon chain="intents" />
                </button>
              )}
              {top.map((c) => (
                <button key={c} type="button" role="tab" aria-selected={net === c} aria-label={chainName(c)} data-tooltip={chainName(c)}
                  className={`${chip(net === c)} w-9 justify-center`} onClick={() => choose(c)}>
                  <NetworkIcon chain={c} />
                </button>
              ))}
            </div>
            {networks.length > 1 && (
              <div ref={menu} className="relative">
                <button type="button" aria-haspopup="menu" aria-expanded={more} className={`${chip(false)} gap-1 pl-3 pr-2 text-sm font-medium`} onClick={() => setMore((m) => !m)}>
                  More<span className={`transition-transform ${more ? "rotate-180" : ""}`}><Icon paths={CHEVRON} size={18} /></span>
                </button>
                {more && (
                  <div role="menu" className="absolute right-0 top-11 z-10 flex max-h-[min(400px,50dvh)] min-w-[200px] flex-col gap-0.5 overflow-y-auto rounded-2xl bg-surface p-2 shadow-[0_6px_48px_rgba(36,38,45,.3)] ring-1 ring-border">
                    {menuItem(ALL, "All networks", <span className="grid size-5 place-items-center"><AllIcon /></span>)}
                    {intents && menuItem("intents", "NEAR Intents", <NetworkIcon chain="intents" />)}
                    <hr className="my-1 border-border" />
                    {networks.map((c) => menuItem(c, chainName(c), <NetworkIcon chain={c} />))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-1 h-[min(52dvh,440px)] overflow-y-auto px-3 pb-3">
          {!tokens.length && !intents ? (
            <p className="px-2 py-12 text-center text-sm text-muted">Loading tokens…</p>
          ) : !groups.length ? (
            <div className="flex flex-col items-center gap-1 px-2 py-12 text-center">
              <p className="font-medium">{needle ? "No results" : "No tokens available"}</p>
              <p className="text-sm text-muted">{needle ? "Try another search or check if a specific network is selected." : "Try selecting a different network."}</p>
              {needle && <button type="button" className="btn btn-ghost mt-3 !py-2 text-sm" onClick={() => setQ("")}>Clear Search</button>}
            </div>
          ) : groups.map((g) => (
            <section key={g.label}>
              <header className="mx-2 border-t border-border pb-2 pt-4 text-xs text-muted">{g.label} — {g.tokens.length}</header>
              <ul>
                {g.tokens.map((t) => {
                  const amount = amountOf(t);
                  const usd = amount > 0n ? usdOf(t, amount) : null;
                  return (
                    <li key={t.assetId}>
                      <button type="button" aria-pressed={t.assetId === selected} onClick={() => onPick(t)}
                        className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${t.assetId === selected ? "bg-text/6" : "hover:bg-text/6"}`}>
                        <TokenIcon token={t} badge />
                        <span className="mr-auto flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-medium">{t.symbol}</span>
                          <span className="truncate text-xs text-muted">{t.symbol} on {chainName(t.blockchain)}</span>
                        </span>
                        {amount > 0n && (
                          <span className="flex shrink-0 flex-col items-end gap-0.5">
                            <span className="text-sm font-medium tabular-nums">{amountText(amount, t.decimals)}</span>
                            <span className="text-xs tabular-nums text-muted">{usd !== null ? money(usd) : "—"}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
        {hint && <p className="border-t border-border px-5 py-3 text-xs text-muted">{hint}</p>}
      </div>
    </div>
  );
}
