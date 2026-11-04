"use client";

import { useEffect, type ReactNode } from "react";
import { themeStyle, type Theme } from "@/lib/theme";
import { FallingEffect } from "./Effect";

/**
 * Applies an event theme to the whole page, header included: its colors and
 * font, and its background behind everything. Undone when you leave the page.
 */
export function Themed({ theme, children }: { theme: Theme; children: ReactNode }) {
  const { vars, background } = themeStyle(theme);
  const key = JSON.stringify(vars);

  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    const prev = entries.map(([k]) => [k, root.style.getPropertyValue(k)] as const);
    for (const [k, v] of entries) {
      if (k.startsWith("--")) root.style.setProperty(k, v);
    }
    root.style.colorScheme = (JSON.parse(key) as { colorScheme: string }).colorScheme;
    return () => {
      for (const [k, v] of prev) {
        if (v) root.style.setProperty(k, v);
        else root.style.removeProperty(k);
      }
      root.style.colorScheme = "";
    };
  }, [key]);

  return (
    <div className="themed" style={vars}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10" style={{ background }} />
      {theme.effect && <FallingEffect emoji={theme.name === "confetti" ? null : theme.emoji} color={theme.color} />}
      {children}
    </div>
  );
}
