"use client";

import { type CSSProperties, type ReactNode } from "react";
import { generativeArt, resolveEventVisual, type EventVisualConfig } from "@/lib/event-visuals";

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

export function VisualBackdrop({ visual, className = "", style, children }: { visual: EventVisualConfig; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid] = resolved.colors;
  if (resolved.theme.group === "near-me") {
    return <div className={`relative isolate overflow-hidden ${className}`} style={{ ...style, backgroundColor: mid, backgroundImage: resolved.backgroundAsset ? undefined : generativeArt(visual) }}>
      {resolved.backgroundAsset && <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-20" style={{ backgroundImage: `url("${resolved.backgroundAsset}")` }} />}
      <div className="relative z-10 flex h-full w-full flex-col justify-end">{children}</div>
    </div>;
  }
  const textureLayers = layerCount(resolved.texture);
  const overlay = resolved.backgroundAsset
    ? "linear-gradient(135deg, #08121a20, #08121a85)"
    : generativeArt(visual);
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
      style={{ ...style, backgroundColor: dark }}
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

/** Decoration stays behind the editor and never changes the application tokens. */
export function EventPageBackground({ visual }: { visual: EventVisualConfig }) {
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 opacity-[0.13] pointer-events-none" data-event-page-background={`${visual.themeId}:${visual.seed}`}>
      <VisualBackdrop visual={visual} className="h-full w-full" />
    </div>
  );
}

export function EventPoster({ title, visual, coverUrl = null, className = "" }: { title: string; visual: EventVisualConfig; coverUrl?: string | null; className?: string }) {
  const resolved = resolveEventVisual(visual);
  const [dark, mid] = resolved.colors;
  let safeCover = "";
  // A host's not-yet-uploaded photo is previewed as a JPEG data URL on /create.
  if (coverUrl?.startsWith("data:image/jpeg;base64,")) safeCover = coverUrl;
  else try {
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
  const imageAsset = safeCover || resolved.coverAsset;
  const imagePosition = safeCover ? "center" : resolved.coverPosition;
  const imageSize = safeCover ? "cover" : resolved.coverSize;
  if (theme.group === "near-me") {
    const ink = imageAsset ? "#ffffff" : dark;
    return (
      <div className={`relative isolate overflow-hidden ${className}`} style={{ containerType: "inline-size", backgroundColor: mid, backgroundImage: imageAsset ? undefined : generativeArt(visual), color: ink }}>
        {imageAsset && <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `linear-gradient(180deg, #0002, #0008), url("${imageAsset}")` }} />}
        <div className="absolute inset-0 flex flex-col justify-between p-[9%]" style={{ fontFamily: "var(--font-display)" }}>
          <span className="text-[clamp(.65rem,4cqw,1rem)] font-bold tracking-[-.05em]">near me</span>
          <span style={{ fontSize: titleSize, lineHeight: 1.12, letterSpacing: "-.045em", fontWeight: 600, overflowWrap: "anywhere" }}>{title}</span>
          <span className="text-[clamp(.5rem,2.6cqw,.75rem)] uppercase tracking-[.14em]">You’re invited</span>
        </div>
      </div>
    );
  }
  const textureLayers = layerCount(resolved.texture);
  const overlay = imageAsset
    ? `linear-gradient(160deg, ${dark}65, #0009)`
    : generativeArt(visual);
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
      {icon && !safeCover && <img src={icon} alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-[8%] -right-[8%] h-[62%] w-[62%] object-contain opacity-[0.16]" />}
      <div className="relative flex items-center gap-2 px-[7%] pt-[7%] text-[clamp(0.48rem,1.5vw,0.72rem)] font-semibold uppercase tracking-[0.18em] text-white/80">
        {icon ? <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 object-contain" /> : <span className="leading-none">{mark}</span>}
        <span className="leading-none">{theme.name}</span>
      </div>
      <span className="block text-white" style={{ ...titleStyle, overflowWrap: "anywhere", lineHeight: 1.08, fontWeight: 700, letterSpacing: "-0.035em" }}>
        {title}
      </span>
    </div>
  );
}
