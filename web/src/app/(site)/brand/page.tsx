/* eslint-disable @next/next/no-img-element -- brand files are shown exactly as people download them */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Snippet } from "@/components/Snippet";

export const metadata: Metadata = {
  title: "Brand · Nearvent",
  description: "Nearvent logo, colors, type and voice, with files to download and a prompt for AI tools.",
};

const SITE = "https://www.nearvent.site";

// Preview backgrounds are fixed colors: each logo file is made for one kind of background.
const LOGOS = [
  { name: "Logo", file: "nearvent-logo", bg: "#fff6fb" },
  { name: "On dark", file: "nearvent-logo-dark", bg: "#1a0b22" },
  { name: "On pink", file: "nearvent-logo-white", bg: "#ff3d8b" },
  { name: "Icon", file: "nearvent-icon", bg: "#ffffff", icon: true },
];

const IDEA = [
  ["Square", "A saved seat. Put down a deposit, and the spot is yours."],
  ["n", "Near: people in one room, with NEAR holding the money."],
  ["Tilt", "Stuck on by hand, like a party sticker. Not a bank."],
];

const COLORS = [
  { name: "Hot pink", hex: "#D61F69", use: "Buttons, links, focus", ink: "#ffffff" },
  { name: "Logo pink", hex: "#FF3D8B", use: "The n-square, big poster blocks", ink: "#1e0b2b" },
  { name: "Ink", hex: "#1E0B2B", use: "Text, main buttons", ink: "#fff6fb" },
  { name: "Blush", hex: "#FFF6FB", use: "Page background", ink: "#1e0b2b" },
];
const RARE = [["Petal", "#FFB3D2"], ["Sun", "#FFD23F"], ["Violet", "#D2CCFF"]];

const VOICE = [
  ["Put down 5 USDC. Show up, get it back.", "Stake tokens in a trustless escrow."],
  ["No-shows’ deposits go to the people who came.", "Earn yield by attending events."],
  ["NEAR handles the money.", "Permissionless on-chain settlement layer."],
];

const PROMPT = `Use the Nearvent brand in what you make (a post, slide, page or video).

Files: use them as they are, never redraw the logo
- Logo on light backgrounds: ${SITE}/brand/nearvent-logo.svg
- Logo on dark backgrounds: ${SITE}/brand/nearvent-logo-dark.svg
- Logo on pink backgrounds: ${SITE}/brand/nearvent-logo-white.svg
- Icon: ${SITE}/brand/nearvent-icon.svg · Avatar: ${SITE}/brand/nearvent-avatar.png
- PNG versions: same names ending in .png

Colors
- Logo pink #FF3D8B: the n-square and big poster blocks (white or ink text on it, 24px+)
- Hot pink #D61F69: buttons and links, white text on it
- Ink #1E0B2B: text · Blush #FFF6FB: background
- Rare: Petal #FFB3D2, Sun #FFD23F, Violet #D2CCFF

Type
- Geist (Google Fonts) for everything; headings weight 600 with tight letter-spacing (-0.04em).
- Geist Mono for money, counts and times: 12.50 USDC, 24 going, 19:30.

Rules
- Don't recolor, stretch, tilt further or add effects to the logo; don't drop the square.
- Keep half the square of empty space around the logo. Below 20px tall, use the icon.
- Put the logo on blush, ink or pink, never on a busy photo.
- Write the name as Nearvent. The slogan is "Events people actually show up to."
- Plain words, short sentences. Say where the money is and when it comes back. No "earn", "win" or crypto jargon.
- Photos of real people at real events, not AI art.

Done when the result uses only these files, colors and fonts. List the ones you used.`;

function Head({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-3">
      <h2 className="text-[clamp(2rem,4vw,2.75rem)] font-semibold tracking-[-0.045em] leading-[1.05]">{title}</h2>
      <p className="max-w-lg text-muted">{children}</p>
    </div>
  );
}

function Download({ href, label }: { href: string; label: string }) {
  return <a href={href} download className="rounded-full border border-border px-3 py-1.5 text-[13px] font-semibold hover:border-accent">{label}</a>;
}

export default function BrandPage() {
  return (
    <div className="space-y-24 pb-8">
      <section className="space-y-8">
        <div className="flex flex-col items-center gap-6 rounded-[32px] bg-[#ff3d8b] px-6 py-16 sm:py-24">
          <img src="/brand/nearvent-logo-white.svg" alt="Nearvent" width={473} height={94} className="h-auto w-4/5 max-w-[640px]" />
          <p className="text-center text-2xl font-semibold tracking-[-0.03em] text-white sm:text-3xl">Events people actually show up to.</p>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-16 gap-y-6">
          <div className="max-w-xl space-y-3">
            <p className="gc-eyebrow">Brand kit</p>
            <h1 className="text-[clamp(2.5rem,5.5vw,4rem)] font-semibold tracking-[-0.05em] leading-[1.02]">Use our logo and colors.</h1>
            <p className="text-lg text-muted">For anyone writing about Nearvent or hosting an event with it. Download the files and keep them as they are.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/brand/nearvent-logo.svg" download className="btn btn-primary">Download Logo</a>
            <a href="#prompt" className="btn btn-ghost">AI Prompt</a>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-8 md:grid-cols-[1fr_1.15fr]">
        <div className="space-y-3">
          <p className="gc-eyebrow">The idea</p>
          <h2 className="text-[clamp(2.25rem,5vw,3.5rem)] font-semibold tracking-[-0.05em] leading-[1.02]">A small promise, kept.</h2>
        </div>
        <dl className="divide-y divide-border rounded-[24px] border border-border bg-surface">
          {IDEA.map(([term, text]) => (
            <div key={term} className="flex gap-6 px-6 py-5">
              <dt className="w-16 shrink-0 text-lg font-semibold text-accent">{term}</dt>
              <dd className="text-lg">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-8">
        <Head title="Logo">The pink square with the n is the heart of the logo. Use the full logo when there is room, the icon when there isn’t.</Head>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LOGOS.map(({ name, file, bg, icon }) => (
            <figure key={file} className="overflow-hidden rounded-[24px] border border-border bg-surface">
              <div className="flex h-48 items-center justify-center px-7" style={{ background: bg }}>
                {icon
                  ? <img src={`/brand/${file}.svg`} alt={`Nearvent ${name.toLowerCase()}`} width={120} height={120} />
                  : <img src={`/brand/${file}.svg`} alt={`Nearvent logo, ${name.toLowerCase()}`} width={473} height={94} className="h-auto w-full max-w-[220px]" />}
              </div>
              <figcaption className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
                <span className="font-semibold">{name}</span>
                <span className="flex gap-1.5"><Download href={`/brand/${file}.svg`} label="SVG" /><Download href={`/brand/${file}.png`} label="PNG" /></span>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="overflow-hidden rounded-[24px] border border-border bg-surface">
            <div className="flex h-48 items-center justify-center bg-[#fff6fb]">
              <div className="rounded-lg border-[1.5px] border-dashed border-[#d61f69] bg-[#ffe4f0] p-7">
                <img src="/brand/nearvent-logo.svg" alt="Nearvent logo with its clear space marked" width={473} height={94} className="block h-12 w-auto" />
              </div>
            </div>
            <div className="space-y-1 border-t border-border px-6 py-5">
              <h3 className="text-xl font-semibold tracking-[-0.03em]">Clear space</h3>
              <p className="text-muted">Keep half the square empty on every side.</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-[24px] border border-border bg-surface">
            <div className="flex h-48 items-center justify-center gap-10 bg-[#fff6fb] text-[#6e5a78]">
              <span className="flex flex-col items-center gap-2"><img src="/brand/nearvent-logo.svg" alt="Nearvent logo at 20 pixels" width={101} height={20} className="h-5 w-auto" /><span className="font-mono text-[13px]">20 px</span></span>
              <span className="flex flex-col items-center gap-2"><img src="/brand/nearvent-icon.svg" alt="Nearvent icon at 16 pixels" width={16} height={16} /><span className="font-mono text-[13px]">16 px</span></span>
            </div>
            <div className="space-y-1 border-t border-border px-6 py-5">
              <h3 className="text-xl font-semibold tracking-[-0.03em]">Minimum size</h3>
              <p className="text-muted">Logo at least 20 px tall. Smaller than that, use the icon.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-8">
        <Head title="Color">One loud pink on soft blush, with ink for text. The other colors are rare guests.</Head>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {COLORS.map(({ name, hex, use, ink }) => (
            <div key={hex} className="flex h-56 flex-col justify-between rounded-[24px] border border-border p-6" style={{ background: hex, color: ink }}>
              <span className="text-2xl font-semibold tracking-[-0.03em]">{name}</span>
              <span className="text-[15px]"><span className="block font-mono">{hex}</span>{use}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {RARE.map(([name, hex]) => (
            <div key={hex} className="flex items-baseline justify-between rounded-[20px] px-6 py-5 text-[#1e0b2b]" style={{ background: hex }}>
              <span className="text-lg font-semibold">{name}</span>
              <span className="font-mono text-sm">{hex}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <Head title="Type">One family, Geist. Geist Mono for anything you count: money, people, time.</Head>
        <div className="flex flex-wrap items-center gap-x-16 gap-y-8 rounded-[24px] border border-border bg-surface p-6 sm:p-12">
          <p className="text-[clamp(7rem,15vw,12rem)] font-semibold tracking-[-0.06em] leading-[0.9]">Aa</p>
          <div className="min-w-0 flex-[1_1_420px] space-y-5">
            <p className="text-[clamp(1.9rem,4vw,3.25rem)] font-semibold tracking-[-0.045em] leading-[1.05]">Events people actually show up to.</p>
            <div className="flex flex-wrap gap-x-7 gap-y-2 text-xl">
              <span className="font-normal">Regular 400</span>
              <span className="font-semibold">Semibold 600</span>
              <span className="font-extrabold tracking-[-0.04em]">Extrabold 800 · logo</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-border pt-5">
              <span className="font-mono text-2xl font-medium">12.50 USDC · 24 going · 19:30</span>
              <span className="text-sm text-muted">Geist Mono</span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-8">
        <Head title="Voice">Plain words, short sentences. Say where the money is and when it comes back. Write the name as Nearvent.</Head>
        <div className="divide-y divide-border overflow-hidden rounded-[24px] border border-border bg-surface">
          {VOICE.map(([say, avoid]) => (
            <div key={say} className="grid sm:grid-cols-2">
              <p className="flex items-baseline gap-3 px-6 py-5 text-lg font-medium">
                <svg className="shrink-0 translate-y-0.5 text-good" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Say"><path d="M5 12.5 10 17 19 7" /></svg>{say}
              </p>
              <p className="flex items-baseline gap-3 px-6 py-5 text-lg text-muted">
                <svg className="shrink-0 translate-y-0.5 text-danger" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" role="img" aria-label="Avoid"><path d="M6 6l12 12M18 6 6 18" /></svg>{avoid}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <Head title="Avatar">For X, Telegram and other profiles. Most apps crop it to a circle.</Head>
        <div className="flex flex-wrap items-center gap-8 rounded-[24px] border border-border bg-surface p-6 sm:p-8">
          <img src="/brand/nearvent-avatar.svg" alt="Nearvent avatar" width={128} height={128} className="rounded-[20px]" />
          <img src="/brand/nearvent-avatar.svg" alt="Nearvent avatar cropped to a circle" width={128} height={128} className="rounded-full" />
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-sm text-muted">400×400</span>
            <Download href="/brand/nearvent-avatar.png" label="PNG" />
            <Download href="/brand/nearvent-avatar.svg" label="SVG" />
          </div>
        </div>
      </section>

      <section id="prompt" className="scroll-mt-24 space-y-8">
        <Head title="AI prompt">Paste it into ChatGPT, Claude or any design tool, then say what you need: a post, a slide, a page.</Head>
        <Snippet title="Nearvent brand prompt" code={PROMPT} long />
      </section>
    </div>
  );
}
