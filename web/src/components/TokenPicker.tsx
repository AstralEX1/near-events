"use client";

// "Pay with": search, a rail of networks (all first, then those holding something) and the
// network's tokens, held ones first with their balances. Layout adapted from NearJar's
// PayWithSheet (github.com/ultratestbro/nearjar, Apache-2.0).
import { useEffect, useMemo, useRef, useState } from "react";
import type { OneClickToken } from "@/lib/oneclick";
import { chainIcon, chainName, tokenIcon } from "@/lib/tokenCatalog";

const ALL = "all";

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

export function TokenIcon({ token, size = 34, badge = false }: { token: OneClickToken; size?: number; badge?: boolean }) {
  const [broken, setBroken] = useState(false);
  const src = tokenIcon(token);
  const chain = chainIcon(token.blockchain);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} className="rounded-full" onError={() => setBroken(true)} />
      ) : (
        <span className="grid place-items-center rounded-full bg-border/60 text-[10px] font-semibold text-muted" style={{ width: size, height: size }}>
          {token.symbol.slice(0, 3)}
        </span>
      )}
      {badge && chain && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={chain} alt="" width={14} height={14} className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-[var(--surface)]" />
      )}
    </span>
  );
}

export function TokenPicker({ tokens, balances, selected, hint, onPick, onClose }: {
  tokens: OneClickToken[];
  /** Held amounts by asset id (wallet mode); empty when sending by hand. */
  balances: Map<string, bigint>;
  selected?: string;
  hint: string;
  onPick: (t: OneClickToken) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const held = (t: OneClickToken) => (balances.get(t.assetId) ?? 0n) > 0n;

  const networks = useMemo(() => {
    const seen = new Map<string, { chain: string; usd: number; held: boolean }>();
    for (const t of tokens) {
      const n = seen.get(t.blockchain) ?? { chain: t.blockchain, usd: 0, held: false };
      if (held(t)) {
        n.held = true;
        n.usd += usdOf(t, balances.get(t.assetId)!) ?? 0;
      }
      seen.set(t.blockchain, n);
    }
    return [...seen.values()].sort((a, b) => Number(b.held) - Number(a.held) || b.usd - a.usd || chainName(a.chain).localeCompare(chainName(b.chain)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, balances]);
  const anyHeld = networks.some((n) => n.held);
  const [net, setNet] = useState(() => (anyHeld ? ALL : tokens.find((t) => t.assetId === selected)?.blockchain ?? networks[0]?.chain ?? ALL));

  useEffect(() => {
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const searching = q.trim().length > 0;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = searching
      ? tokens.filter((t) => t.symbol.toLowerCase().includes(needle) || chainName(t.blockchain).toLowerCase().includes(needle))
      : net === ALL ? tokens.filter(held) : tokens.filter((t) => t.blockchain === net);
    const usd = (t: OneClickToken) => (held(t) ? usdOf(t, balances.get(t.assetId)!) ?? 0 : -1);
    return [...list].sort((a, b) => usd(b) - usd(a) || a.symbol.localeCompare(b.symbol));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, balances, q, net, searching]);
  const current = networks.find((n) => n.chain === net);
  const heading = searching ? "Search results" : net === ALL ? "Your tokens" : chainName(net);
  const headingUsd = searching ? null : net === ALL ? (anyHeld ? networks.reduce((s, n) => s + n.usd, 0) : null) : current?.held ? current.usd : null;
  const showNetwork = searching || net === ALL;

  return (
    <div className="gc-sheet-backdrop" onClick={onClose}>
      <div className="gc-sheet" role="dialog" aria-modal="true" aria-label="Pay with" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="font-semibold text-lg">Pay with</h2>
          <button type="button" aria-label="Close" className="text-muted text-2xl leading-none px-1" onClick={onClose}>×</button>
        </div>
        <div className="px-5 pt-3">
          <input ref={search} className="input w-full" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search tokens or networks" aria-label="Search tokens or networks" />
        </div>
        <div className="mt-3 flex h-[min(56dvh,480px)] border-y border-border">
          <div role="tablist" aria-label="Networks" className="flex w-[64px] shrink-0 flex-col items-center gap-1.5 overflow-y-auto border-r border-border py-3 sm:w-48 sm:items-stretch sm:gap-0.5 sm:px-2">
            {[{ chain: ALL, usd: 0, held: false }, ...networks].map((n) => {
              const active = !searching && n.chain === net;
              const label = n.chain === ALL ? "All networks" : chainName(n.chain);
              const icon = n.chain === ALL ? undefined : chainIcon(n.chain);
              return (
                <button key={n.chain} type="button" role="tab" aria-selected={active} aria-label={n.held ? `${label}, has balance` : label}
                  onClick={() => { setQ(""); setNet(n.chain); }}
                  className={`relative flex size-[48px] shrink-0 items-center justify-center gap-2.5 rounded-2xl border transition sm:h-10 sm:w-full sm:justify-start sm:rounded-xl sm:px-2 ${active ? "border-accent/50 bg-accent/10" : "border-transparent hover:bg-border/40"}`}>
                  {icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={icon} alt="" width={28} height={28} className="rounded-full" />
                  ) : (
                    <span className="grid size-[28px] place-items-center rounded-full bg-border/60 text-[9px] font-semibold text-muted">{n.chain === ALL ? "ALL" : label.slice(0, 3)}</span>
                  )}
                  <span className={`hidden min-w-0 flex-1 truncate text-left text-sm sm:block ${active ? "" : "text-muted"}`}>{label}</span>
                  {n.held && <span className="absolute right-1 top-1 size-[7px] rounded-full bg-accent sm:static sm:shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-baseline justify-between gap-3 px-4 pb-1.5 pt-3.5">
              <p className="truncate font-medium">{heading}</p>
              {headingUsd !== null && <p className="shrink-0 text-xs tabular-nums text-muted">{money(headingUsd)}</p>}
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 pb-4">
              {shown.length === 0 && (
                <p className="p-2.5 text-sm text-muted">
                  {searching ? `Nothing matches “${q.trim()}”.` : net === ALL ? "No tokens in this wallet yet. Pick a network on the left." : "No tokens on this network."}
                </p>
              )}
              {shown.map((t) => {
                const amount = balances.get(t.assetId) ?? 0n;
                const usd = amount > 0n ? usdOf(t, amount) : null;
                return (
                  <button key={t.assetId} type="button" aria-pressed={t.assetId === selected} onClick={() => onPick(t)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${t.assetId === selected ? "bg-accent/10" : "hover:bg-border/40"}`}>
                    <TokenIcon token={t} badge={showNetwork} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{t.symbol}</span>
                      {showNetwork && <span className="truncate text-xs text-muted">{chainName(t.blockchain)}</span>}
                    </span>
                    {amount > 0n && (
                      <span className="flex shrink-0 flex-col items-end">
                        <span className="text-sm tabular-nums">{amountText(amount, t.decimals)}</span>
                        <span className="text-xs tabular-nums text-muted">{usd !== null ? money(usd) : "—"}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="px-5 py-3 text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}
