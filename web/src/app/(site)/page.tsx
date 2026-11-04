"use client";

import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { events } from "@/lib/near";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;

// Copy follows docs/VALUE-PROPOSITION-CANVAS.md: the root pain is that an RSVP
// costs nothing (A1), so lists lie (K1–K8); the fix is good friction, a
// refundable deposit, not a ticket (G0, G3); and we remove Kickback's bad
// friction: wallets, gas, fees, another portal (N1–N4).

/** The product page for organizers. */
export default function Landing() {
  const demo = useRef<HTMLDivElement>(null);
  const [eventId, setEventId] = useState<number | null>(null);

  useEffect(() => {
    events.list().then((l) => setEventId(l.find((e) => e.status === "Open")?.id ?? null)).catch(() => {});
  }, []);
  useEffect(() => {
    if (demo.current && eventId !== null) demo.current.innerHTML = `<near-event event="${eventId}"></near-event>`;
  }, [eventId]);

  const primary = BOT ? (
    <a href={`https://t.me/${BOT}`} className="btn btn-accent !py-3">Start in Telegram</a>
  ) : (
    <Link href="/create" className="btn btn-accent !py-3">Create an event</Link>
  );

  return (
    <div className="space-y-24 pt-6 pb-10">
      <Script src="/embed.js" strategy="afterInteractive" />

      {/* A1 + G0: the root cause and the fix */}
      <section className="grid gap-10 md:grid-cols-[1.1fr_1fr] items-center">
        <div className="space-y-5">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Clicking “Going” costs nothing. That’s why half don’t come.
          </h1>
          <p className="text-lg text-muted max-w-lg">
            Add a little friction: every guest puts down the same small, refundable deposit. People who show up get it
            back plus a share of the no-shows. Your event stays free.
          </p>
          <div className="flex flex-wrap gap-3">
            {primary}
            <Link href="/widget" className="btn btn-ghost !py-3">Add to my website</Link>
          </div>
          <p className="text-sm text-muted">No fee. The money sits in a smart contract, never with you or with us.</p>
        </div>
        <div className="rounded-3xl border border-border p-5 sm:p-8 bg-[color-mix(in_srgb,var(--accent)_5%,var(--bg))]">
          <div className="text-xs text-muted mb-3">The real thing, live on testnet:</div>
          <div ref={demo}>{eventId === null && <div className="h-56 rounded-2xl bg-border/40" />}</div>
        </div>
      </section>

      {/* G1: the proof number, with its source */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat big="~50%" text="of people who RSVP “yes” to a free event never show up." />
        <Stat big="~10%" text="no-shows when the same RSVP comes with a small deposit." />
        <Stat big="$0" text="platform fee. The whole pool goes to the people who came." />
        <p className="sm:col-span-3 text-xs text-muted">
          First two numbers as reported by Kickback, which ran this same model on Ethereum (
          <a className="underline" href="https://medium.com/noblocknoparty/how-blockparty-can-decrease-no-shows-at-your-next-event-5e5895f1a23f">
            source
          </a>
          ).
        </p>
      </section>

      {/* K3 + K4: the free-event dilemma, and why a deposit is not a ticket */}
      <section className="space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight max-w-2xl">Every free event has the same dilemma</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Let anyone in" text="The room overflows, the food runs out, and nobody has a good time." />
          <Card
            title="Take RSVPs"
            text="The list fills in a day with people who never meant to come. On the day: half a room and wasted catering."
           
          />
          <Card
            title="Sell tickets"
            text="Turnout improves, but you lose to the free event next door, and your community feels charged."
           
          />
        </div>
        <div className="card p-6 sm:p-8 grid gap-4 md:grid-cols-[1fr_1.4fr] items-center border-accent/30">
          <div className="text-2xl font-semibold tracking-tight">A deposit isn’t a ticket.</div>
          <p className="text-muted">
            Guests who come get every cent back, plus a bonus from those who didn’t. The event stays free for everyone who
            shows up, your list is real, and the seats go to people who want them.
          </p>
        </div>
      </section>

      {/* T5: why it works */}
      <section className="space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight">Why it works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            ["It filters", "People who were never coming don’t take a seat. A few dollars is enough to make “maybe” decide."],
            ["Nobody likes losing money", "Once guests have put something down, they plan around the event instead of skipping it."],
            ["Showing up pays", "No-shows stop being your problem and become a small bonus for the people who came."],
          ].map(([t, d]) => (
            <div key={t} className="space-y-2">
              <div className="font-semibold text-lg">{t}</div>
              <p className="text-muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Kickback's triad: organisers / sponsors / guests */}
      <section className="grid gap-4 md:grid-cols-3">
        <Who
          title="For organizers"
          items={[
            "A firm headcount for the venue and the food",
            "Budget on real turnout, not on RSVPs",
            "Every deposit, check-in and payout in Telegram",
            "You never hold anyone’s money",
          ]}
        />
        <Who
          title="For sponsors"
          items={[
            "An audience that committed, not a list of maybes",
            "A public list of who registered and who came",
            "Top up the pool to reward people who show up",
          ]}
        />
        <Who
          title="For guests"
          items={[
            "No more “event full” because of fake RSVPs",
            "Get paid a little for keeping your word",
            "Sign in with Google, pay from almost any wallet or chain",
          ]}
        />
      </section>

      {/* N2: three ways in, none of them a new portal */}
      <section className="space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight">Keep your tools. Add the deposit.</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Your own event page", "Set up like Luma: cover, time, place, registration with a deposit, guest list, QR check-in.", "/create", "Create an event"],
            ["Next to Luma", "Paste your Luma link and we import the event. Put our link where Luma’s register button was.", "/create", "Import from Luma"],
            ["On your website", "A button or event card on Tilda, Webflow, WordPress or any site. Two lines of code, or one prompt for your AI agent.", "/widget", "Get the button"],
          ].map(([t, d, href, cta]) => (
            <Link key={t} href={href} className="card p-5 flex flex-col gap-2 hover:border-accent/40 transition-colors">
              <div className="font-semibold text-lg">{t}</div>
              <p className="text-sm text-muted flex-1">{d}</p>
              <span className="text-sm text-accent font-medium">{cta} →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* N1, N3, N4: what killed the old version, fixed */}
      <section className="space-y-6">
        <h2 className="text-3xl font-semibold tracking-tight">Deposits without the crypto headaches</h2>
        <div className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {[
            ["No wallet required", "Guests sign in with Google or email. Crypto users can pay from almost any token on any chain."],
            ["No gas, no extra steps", "One confirmation to register. Payouts land in a balance you withdraw whenever you like."],
            ["Not custodial", "Deposits sit in a NEAR smart contract. Payouts and refunds need the host’s confirmation, or a DAO vote."],
            ["Check-in that can’t get lost", "Scan guests’ QR codes or tap their names in Telegram. No paper lists to argue about later."],
          ].map(([t, d]) => (
            <div key={t} className="flex gap-3">
              <span className="text-good mt-0.5">✓</span>
              <div>
                <div className="font-medium">{t}</div>
                <p className="text-sm text-muted">{d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-border p-6 sm:p-10 space-y-4 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Make your next RSVP list tell the truth.</h2>
        <p className="text-muted">Set it up in a few minutes. Free, because the pool belongs to your guests.</p>
        <div className="flex flex-wrap gap-3 justify-center">
          {primary}
          <Link href="/guide" className="btn btn-ghost !py-3">How it works</Link>
        </div>
      </section>
    </div>
  );
}

function Stat({ big, text }: { big: string; text: string }) {
  return (
    <div className="card p-5">
      <div className="text-4xl font-semibold tracking-tight">{big}</div>
      <p className="text-sm text-muted mt-2">{text}</p>
    </div>
  );
}

function Card({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl bg-border/30 p-5">
      <div className="font-semibold">{title}</div>
      <p className="text-sm text-muted mt-1">{text}</p>
    </div>
  );
}

function Who({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="card p-5 space-y-3">
      <div className="font-semibold text-lg">{title}</div>
      <ul className="space-y-2 text-sm text-muted">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent">•</span>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
