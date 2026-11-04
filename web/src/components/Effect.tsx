"use client";

import { useEffect, useState } from "react";

/**
 * Partiful-style opening effect: a handful of emoji (or confetti) fall once
 * and disappear. Skipped for people who prefer reduced motion.
 */
export function FallingEffect({ emoji, color }: { emoji: string | null; color: string }) {
  const [pieces, setPieces] = useState<{ left: number; delay: number; dur: number; rot: number; size: number; col: string }[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cols = [color, "#f59e0b", "#ec4899", "#0ea5e9", "#16a34a"];
    setPieces(
      Array.from({ length: 28 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        dur: 2.2 + Math.random() * 1.6,
        rot: Math.random() * 720 - 360,
        size: emoji ? 18 + Math.random() * 14 : 6 + Math.random() * 6,
        col: cols[i % cols.length],
      })),
    );
    const done = setTimeout(() => setPieces([]), 4500);
    return () => clearTimeout(done);
  }, [emoji, color]);

  if (pieces.length === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute -top-10 fall"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            fontSize: p.size,
            ["--rot" as string]: `${p.rot}deg`,
          }}
        >
          {emoji ?? <span className="block rounded-sm" style={{ width: p.size, height: p.size * 1.8, background: p.col }} />}
        </span>
      ))}
    </div>
  );
}
