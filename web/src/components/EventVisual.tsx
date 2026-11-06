"use client";

import type { CSSProperties, ReactNode } from "react";
import { resolveEventVisual, type EventVisualConfig } from "@/lib/event-visuals";

function layerCount(images: string): number {
  let depth = 0;
  let count = 1;
  for (const char of images) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) count++;
  }
  return count;
}

export function VisualBackdrop({ visual, className = "", children }: { visual: EventVisualConfig; className?: string; children?: ReactNode }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid, light] = resolved.colors;
  const textureLayers = layerCount(resolved.texture);
  const overlay = resolved.backgroundAsset
    ? "linear-gradient(135deg, #08121a20, #08121a85)"
    : `radial-gradient(ellipse at 78% 18%, ${light}70, transparent 48%), linear-gradient(135deg, ${dark}, ${mid} 58%, ${dark})`;
  const backgroundImage = `${resolved.texture}, ${overlay}${resolved.backgroundAsset ? `, url("${resolved.backgroundAsset}")` : ""}`;
  const backgroundPosition = resolved.backgroundAsset
    ? `${Array(textureLayers).fill("center").join(", ")}, ${resolved.backgroundPosition}, ${resolved.backgroundPosition}`
    : "center";
  const backgroundSize = resolved.backgroundAsset
    ? `${Array(textureLayers).fill("auto").join(", ")}, ${resolved.backgroundSize}, ${resolved.backgroundSize}`
    : undefined;
  const backgroundRepeat = resolved.backgroundAsset
    ? `${Array(textureLayers).fill("repeat").join(", ")}, no-repeat, no-repeat`
    : undefined;
  return (
    <div
      className={`relative isolate overflow-hidden ${className}`}
      style={{ backgroundColor: dark }}
    >
      <div
        aria-hidden="true"
        className="absolute -inset-2 z-0"
        style={{ backgroundColor: dark, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat, filter: "blur(3px)", transform: "scale(1.02)" }}
      />
      <div aria-hidden="true" className="absolute inset-0 z-0 bg-black/[0.06]" />
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
  const imageAsset = safeCover || resolved.coverAsset;
  const imagePosition = safeCover ? "center" : resolved.coverPosition;
  const imageSize = safeCover ? "cover" : resolved.coverSize;
  const textureLayers = layerCount(resolved.texture);
  const overlay = imageAsset
    ? `linear-gradient(160deg, ${dark}65, #0009)`
    : `radial-gradient(ellipse at 75% 15%, ${light}a6, transparent 50%), linear-gradient(145deg, ${dark}, ${mid} 58%, ${dark})`;
  const backgroundImage = `${resolved.texture}, ${overlay}${imageAsset ? `, url("${imageAsset}")` : ""}`;
  const backgroundPosition = imageAsset
    ? `${Array(textureLayers).fill("center").join(", ")}, ${imagePosition}, ${imagePosition}`
    : "center";
  const backgroundSize = imageAsset
    ? `${Array(textureLayers).fill("auto").join(", ")}, ${imageSize}, ${imageSize}`
    : undefined;
  const backgroundRepeat = imageAsset
    ? `${Array(textureLayers).fill("repeat").join(", ")}, no-repeat, no-repeat`
    : undefined;
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
    <div className={`relative isolate overflow-hidden text-white ${className}`} style={{ containerType: "inline-size", backgroundColor: dark, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat }}>
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
