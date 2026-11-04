"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { events } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

/**
 * The product page for organizers. Near Events is a button for their own
 * site plus an admin in Telegram, not another place to list events.
 */
export default function Landing() {
  const demo = useRef<HTMLDivElement>(null);
  const [eventId, setEventId] = useState<number | null>(null);

  useEffect(() => {
    events.list().then((l) => setEventId(l.find((e) => e.status === "Open")?.id ?? null)).catch(() => {});
  }, []);
  useEffect(() => {
    if (demo.current && eventId !== null) demo.current.innerHTML = `<near-event event="${eventId}"></near-event>`;
  }, [eventId]);

  return (
    <div className="space-y-20 pt-6 pb-10">
      <Script src="/embed.js" strategy="afterInteractive" />

      <section className="grid gap-10 md:grid-cols-[1.1fr_1fr] items-center">
        <div className="space-y-5">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Half your RSVPs don’t show up. Make them.
          </h1>
          <p className="text-lg text-muted max-w-lg">
            Add a refundable deposit to registration. People who come get it back plus a share of the no-shows. Run it
            from Telegram. No fee.
          </p>
          <div className="flex flex-wrap gap-3">
            {BOT ? (
              <a href={`https://t.me/${BOT}`} className="btn btn-accent !py-3">Start in Telegram</a>
            ) : (
              <Link href="/widget" className="btn btn-accent !py-3">Get the button</Link>
            )}
            <Link href="/create" className="btn btn-ghost !py-3">Create an event</Link>
          </div>
          <p className="text-sm text-muted">Your own event page, a link next to Luma, or a button on Tilda, Webflow, WordPress or any site.</p>
        </div>
        <div className="rounded-3xl border border-border p-5 sm:p-8 bg-[color-mix(in_srgb,var(--accent)_5%,var(--bg))]">
          <div className="text-xs text-muted mb-3">This is the real widget, live on testnet:</div>
          <div ref={demo}>{eventId === null && <div className="h-56 rounded-2xl bg-border/40" />}</div>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">Three ways to use it</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Event page", "A page for your event, set up like Luma: cover, time, place, registration with a deposit, guest list, check-in.", "/create", "Create an event"],
            ["Next to Luma", "Paste your Luma link and we import the event. Put our link on Luma instead of its register button; everyone signs up and pays here.", "/create", "Import from Luma"],
            ["On your website", "A button or event card on the site you already have. Two lines of code, or one prompt for your AI agent.", "/widget", "Get the button"],
          ].map(([t, d, href, cta]) => (
            <Link key={t} href={href} className="card p-5 flex flex-col gap-2 hover:border-accent/40 transition-colors">
              <div className="font-semibold text-lg">{t}</div>
              <p className="text-sm text-muted flex-1">{d}</p>
              <span className="text-sm text-accent font-medium">{cta} →</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            ["Create the event in Telegram", "Tell the bot the name, date, deposit and spots. Confirm once with Google. The event and its money stay under your account."],
            ["Put the button on your site", "Two lines of code, or send one prompt to your AI agent. Already on Luma or Typeform? Guests pay first, then land on your usual form."],
            ["Check people in, pay out", "Tap guests in Telegram or scan their QR. Close the event and everyone who came splits the pool. Refund anyone in one tap."],
          ].map(([t, d], i) => (
            <div key={t} className="space-y-2">
              <div className="w-8 h-8 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center">{i + 1}</div>
              <div className="font-semibold">{t}</div>
              <p className="text-sm text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-8 md:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight">Your guests</h2>
          <ul className="space-y-2 text-muted">
            <li>Pay with Google sign-in, a NEAR wallet, or almost any token from any chain.</li>
            <li>Get their deposit back for coming, plus a share of the no-shows.</li>
            <li>See where the money is: a public smart contract, not your bank account.</li>
          </ul>
        </div>
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold tracking-tight">You</h2>
          <ul className="space-y-2 text-muted">
            <li>A message for every deposit, the guest list and a CSV, all in Telegram.</li>
            <li>On Luma Plus: paid guests appear in Luma, and Luma check-ins count for the payout.</li>
            <li>Never hold anyone’s money. Payouts and refunds need your confirmation.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-3xl border border-border p-6 sm:p-10 space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">Have an AI agent add it</h2>
        <p className="text-muted max-w-2xl">
          Open Claude Code, Cursor or Codex in your website’s project and send it the prompt from the widget page. It knows
          where the code goes for your stack. Agents can also read <a href="/llms.txt" className="text-accent">/llms.txt</a>.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/widget" className="btn btn-primary">Copy the prompt</Link>
          <a href="/demo/balisquad.html" className="btn btn-ghost">Example: Bali Squad</a>
        </div>
      </section>

      <section className="text-sm text-muted flex flex-wrap gap-x-6 gap-y-2">
        <span>No platform fee</span>
        <span>USDC on NEAR</span>
        <span>Refund if the host cancels or disappears</span>
        <Link href="/events" className="text-accent">Browse events</Link>
        <Link href="/guide" className="text-accent">Guide & FAQ</Link>
      </section>
    </div>
  );
}
