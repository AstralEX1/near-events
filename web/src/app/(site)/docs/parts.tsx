import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_PAGES } from "./pages";

export function Title({ children, lead }: { children: ReactNode; lead: ReactNode }) {
  return (
    <div className="mb-10">
      <h1 className="gc-page-title">{children}</h1>
      <p className="text-muted mt-2 text-lg">{lead}</p>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-12 scroll-mt-24">
      <h2 className="text-xl font-semibold mb-4">
        <a href={`#${id}`} className="hover:text-accent">{title}</a>
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export function Steps({ items }: { items: [string, ReactNode][] }) {
  return (
    <ol className="space-y-3">
      {items.map(([t, d], i) => (
        <li key={t} className="flex gap-4">
          <span className="w-8 h-8 shrink-0 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center">{i + 1}</span>
          <div>
            <div className="font-medium">{t}</div>
            <div className="text-sm text-muted">{d}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="space-y-2">
      {items.map(([q, a]) => (
        <details key={q} className="card px-4 py-3 group">
          <summary className="font-medium cursor-pointer list-none flex items-center justify-between gap-3">
            {q}
            <span className="text-muted group-open:rotate-45 transition-transform">+</span>
          </summary>
          <div className="text-sm text-muted mt-2">{a}</div>
        </details>
      ))}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto card">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            {head.map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => <td key={j} className="px-4 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Code({ children }: { children: string }) {
  return <pre className="card overflow-x-auto px-4 py-3 text-xs font-mono leading-relaxed">{children}</pre>;
}

export const Mono = ({ children }: { children: ReactNode }) => <code className="font-mono text-[0.9em] break-all">{children}</code>;

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">{children}</a>;
}

/** "Next: …" link at the bottom of a page. */
export function Next({ from }: { from: string }) {
  const i = DOCS_PAGES.findIndex((p) => p.href === from);
  const next = DOCS_PAGES[i + 1];
  if (!next) return null;
  return (
    <Link href={next.href} className="card flex items-center justify-between px-5 py-4 hover:border-accent">
      <span><span className="block text-xs text-muted">Next</span><span className="font-medium">{next.label}</span></span>
      <span aria-hidden className="text-accent">→</span>
    </Link>
  );
}
