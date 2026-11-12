"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_PAGES } from "./pages";


/** Sidebar on desktop, a row of tabs on phones. */
export function DocsNav() {
  const path = usePathname();
  return (
    <nav aria-label="Docs" className="md:w-44 md:shrink-0">
      <div className="hidden md:block text-xs font-semibold uppercase tracking-[0.12em] text-muted mb-3">Docs</div>
      <ul className="flex gap-2 overflow-x-auto md:flex-col md:gap-1 md:sticky md:top-24">
        {DOCS_PAGES.map((p) => {
          const active = path === p.href;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-full px-3 py-1.5 text-sm md:rounded-xl ${active ? "bg-accent-soft text-accent font-medium" : "text-muted hover:text-text"}`}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
