"use client";

import type { CSSProperties, ReactNode } from "react";
import { resolveEventVisual, type EventVisualConfig } from "@/lib/event-visuals";

export function VisualBackdrop({ visual, className = "", children }: { visual: EventVisualConfig; className?: string; children?: ReactNode }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid, light] = resolved.colors;
  const baseBackground = `radial-gradient(ellipse at 78% 18%, ${light}70, transparent 48%), linear-gradient(135deg, ${dark}, ${mid} 58%, ${dark})`;
  const backgroundImage = resolved.backgroundAsset
    ? `linear-gradient(135deg, #08121a20, #08121a85), url("${resolved.backgroundAsset}")`
    : baseBackground;
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ backgroundColor: dark, backgroundImage, backgroundSize: resolved.backgroundAsset ? "cover, cover" : undefined, backgroundPosition: "center" }}
    >
      <div aria-hidden="true" className="absolute inset-0 z-0 opacity-50" style={{ backgroundImage: resolved.texture }} />
      <div className="relative z-10 flex h-full w-full flex-col justify-end">{children}</div>
    </div>
  );
}

export function EventPoster({ title, visual, coverUrl = null, className = "" }: { title: string; visual: EventVisualConfig; coverUrl?: string | null; className?: string }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid, light] = resolved.colors;
  let safeCover = "";
  try {
    const url = new URL(coverUrl ?? "");
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) safeCover = url.href;
  } catch {}
  const titleLength = Array.from(title).length;
  const isLong = titleLength > 42;
  const layout = resolved.layout;
  const titleSize = titleLength > 80
    ? "clamp(0.5rem, 5.5cqw, 1.05rem)"
    : isLong
      ? "clamp(0.55rem, 8cqw, 1.45rem)"
      : "clamp(0.55rem, 13cqw, 2.25rem)";
  const theme = resolved.theme;
  const icon = "icon" in theme ? theme.icon : undefined;
  const mark = theme.mark;
  const iconClass = theme.id === "near" ? "brightness-0 invert" : "";
  const backgroundImage = safeCover
    ? `${resolved.texture}, linear-gradient(160deg, #0003, #0009), url("${safeCover}")`
    : `${resolved.texture}, radial-gradient(ellipse at 75% 15%, ${light}a6, transparent 50%), linear-gradient(145deg, ${dark}, ${mid} 58%, ${dark})`;
  const titleStyle: CSSProperties = {
    position: "absolute",
    top: layout === "center" ? "50%" : layout === "offset" ? "42%" : undefined,
    bottom: layout === "lower" ? "8%" : undefined,
    left: "8%",
    right: "8%",
    transform: layout === "center" ? "translateY(-50%)" : undefined,
    fontFamily: resolved.fontFamily,
    fontSize: titleSize,
    textAlign: layout === "offset" ? "left" : "center",
    textShadow: "0 2px 18px #0009",
  };
  return (
    <div className={`relative isolate overflow-hidden text-white ${className}`} style={{ containerType: "inline-size", backgroundColor: dark, backgroundImage, backgroundSize: safeCover ? "auto, cover, cover" : undefined, backgroundPosition: "center" }}>
      <div className="relative flex items-center gap-2 px-[7%] pt-[7%] text-[clamp(0.48rem,1.5vw,0.72rem)] font-semibold uppercase tracking-[0.18em] text-white/80">
        {icon ? <img src={icon} alt="" aria-hidden="true" className={`h-5 w-5 object-contain opacity-90 ${iconClass}`} /> : <span className="leading-none">{mark}</span>}
        <span className="leading-none">{theme.name}</span>
      </div>
      <span className="block text-white" style={{ ...titleStyle, overflowWrap: "anywhere", lineHeight: 1.08, fontWeight: 700, letterSpacing: "-0.035em" }}>
        {title}
      </span>
    </div>
  );
}
