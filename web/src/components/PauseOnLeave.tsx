"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Next keeps a page you left mounted but hidden (cacheComponents → React Activity), so a video on it
 * keeps playing with sound. Hiding runs effect cleanups: pause every unmuted video inside, iframes included.
 * Muted loops (the landing gallery) are left alone so they still play when you come back.
 */
export function PauseOnLeave({ children, className = "contents" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = box.current;
    return () => {
      if (!root) return;
      const docs = [root, ...[...root.querySelectorAll("iframe")].flatMap((f) => f.contentDocument ?? [])];
      docs.forEach((d) => d.querySelectorAll("video").forEach((v) => { if (!v.muted) v.pause(); }));
    };
  }, []);
  return <div ref={box} className={className}>{children}</div>;
}
