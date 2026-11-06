"use client";

import type { CSSProperties, ReactNode } from "react";
import { resolveEventVisual, type EventVisualConfig } from "@/lib/event-visuals";

export function VisualBackdrop({ visual, className = "", children }: { visual: EventVisualConfig; className?: string; children?: ReactNode }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid, light] = resolved.colors;
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ backgroundColor: dark, backgroundImage: `radial-gradient(ellipse at 78% 18%, ${light}70, transparent 48%), linear-gradient(135deg, ${dark}, ${mid} 58%, ${dark})` }}
    >
      {resolved.backgroundAsset && <img src={resolved.backgroundAsset} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
      {resolved.backgroundAsset && <div className="absolute inset-0 -z-10 bg-gradient-to-br from-black/10 via-black/15 to-black/45" />}
      <div aria-hidden="true" className="absolute inset-0 -z-10 opacity-50" style={{ backgroundImage: resolved.texture }} />
      {children}
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
  const isLong = title.length > 42;
  const layout = resolved.layout;
  const titleSize = isLong ? "clamp(0.8rem, 2.3vw, 1.45rem)" : "clamp(1.1rem, 3.8vw, 2.25rem)";
  const theme = resolved.theme;
  const icon = "icon" in theme ? theme.icon : undefined;
  const mark = theme.mark;
  const backgroundImage = `${resolved.texture}, radial-gradient(ellipse at 75% 15%, ${light}a6, transparent 50%), linear-gradient(145deg, ${dark}, ${mid} 58%, ${dark})`;
  const titleStyle: CSSProperties = {
    fontFamily: resolved.fontFamily,
    fontSize: titleSize,
    textAlign: layout === "offset" ? "left" : "center",
    alignSelf: "stretch",
    marginTop: layout === "center" ? "auto" : undefined,
    marginBottom: layout === "lower" ? "3%" : undefined,
    textShadow: "0 2px 18px #0009",
  };
  return (
    <div className={`relative isolate flex flex-col justify-between overflow-hidden text-white ${className}`} style={{ backgroundColor: dark, backgroundImage }}>
      {safeCover && <img src={safeCover} alt="" aria-hidden="true" referrerPolicy="no-referrer" className="absolute inset-0 -z-10 h-full w-full object-cover" />}
      {(safeCover || resolved.backgroundAsset) && <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/20 to-black/25" />}
      <div className="relative flex items-center gap-2 px-[7%] pt-[7%] text-[clamp(0.48rem,1.5vw,0.72rem)] font-semibold uppercase tracking-[0.18em] text-white/80">
        {icon ? <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 object-contain brightness-0 invert opacity-90" /> : <span className="leading-none">{mark}</span>}
        <span className="leading-none">{theme.name}</span>
      </div>
      <span className="relative block px-[8%] pb-[8%] text-white" style={{ ...titleStyle, overflowWrap: "anywhere", lineHeight: 1.08, fontWeight: 700, letterSpacing: "-0.035em" }}>
        {title}
      </span>
    </div>
  );
}
