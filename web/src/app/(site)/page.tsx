"use client";

import Link from "next/link";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT;
const CREATE = "/create";
const PRIMARY_HREF = BOT ? `https://t.me/${BOT}` : CREATE;
const PRIMARY_LABEL = BOT ? "Create your first deposit event" : "Create your first deposit event";

// Copy: docs/VALUE-PROPOSITION-CANVAS.md. Conversion shape: Shopify + Unbounce —
// one goal, specific CTA, social proof, product-in-action, short mid-page.

/** The product page for organizers. */
export default function Landing() {
  return (
    <div className="space-y-20 pt-6 pb-10">
      {/* Z-pattern hero: headline → sub → one CTA → product frames */}
      <section className="grid gap-10 md:grid-cols-[1.15fr_1fr] items-center">
        <div className="space-y-5">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05]">
            Clicking “Going” costs nothing, so half the people who click it don’t come.
          </h1>
          <p className="text-lg text-muted max-w-lg">
            Add a little friction: every guest puts down the same small, refundable deposit. People who show up get it
            back plus a share of the no-shows. Your event stays free.
          </p>
          <div className="space-y-2">
            <PrimaryCta />
            <p className="text-sm text-muted max-w-md">
              ~3 minutes · No fee · Cancel the event and everyone is refunded · A no-show only loses their own deposit
            </p>
          </div>
        </div>
        <ProductFrames />
      </section>

      {/* Proof as one comparison, not a dashboard */}
      <section className="space-y-3">
        <p className="text-xl sm:text-2xl font-semibold tracking-tight leading-snug max-w-3xl">
          Free RSVP: ~<span className="text-warn">50%</span> no-shows.{" "}
          Same RSVP with a deposit: ~<span className="text-good">10%</span>.{" "}
          <span className="text-muted font-medium">Platform fee: $0.</span>
        </p>
        <p className="text-xs text-muted">
          Turnout numbers as reported by Kickback on the same deposit model (
          <a
            className="underline hover:text-text"
            href="https://medium.com/noblocknoparty/how-blockparty-can-decrease-no-shows-at-your-next-event-5e5895f1a23f"
          >
            source
          </a>
          ).
        </p>
      </section>

      {/* Social proof */}
      <section className="grid gap-4 md:grid-cols-2">
        <blockquote className="card p-6 space-y-3">
          <p className="text-lg leading-snug">
            “Unfortunately, everybody turned up!” — the joke hosts told when deposits worked and the room was full.
          </p>
          <footer className="text-sm text-muted">
            Kickback / BlockParty hosts, 2016–2023 ·{" "}
            <a
              className="underline hover:text-text"
              href="https://medium.com/noblocknoparty/how-blockparty-can-decrease-no-shows-at-your-next-event-5e5895f1a23f"
            >
              their write-up
            </a>
          </footer>
        </blockquote>
        <div className="card p-6 flex flex-col justify-between gap-4">
          <div className="space-y-2">
            <div className="font-semibold text-lg">See it on a real community page</div>
            <p className="text-sm text-muted">
              Bali Squad–style embed: deposit button on the host’s own site, not another portal.
            </p>
          </div>
          <a href="/demo/balisquad.html" className="text-sm text-accent font-medium hover:underline">
            Open the Bali Squad demo →
          </a>
        </div>
      </section>

      {/* Free-event dilemma */}
      <section className="space-y-5">
        <h2 className="text-3xl font-semibold tracking-tight max-w-2xl">Every free event has the same dilemma</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Card title="Let anyone in" text="The room overflows, the food runs out, and nobody has a good time." />
          <Card
            title="Take RSVPs"
            text="The list fills with people who never meant to come. On the day: half a room and wasted catering."
          />
          <Card
            title="Sell tickets"
            text="Turnout improves, but you lose to the free event next door, and your community feels charged."
          />
        </div>
        <div className="rounded-2xl border border-border bg-border/20 p-5 sm:p-6 grid gap-2 md:grid-cols-[1fr_1.5fr] md:items-center">
          <div className="text-xl font-semibold tracking-tight">The fourth option: a refundable deposit.</div>
          <p className="text-muted text-sm sm:text-base">
            Everyone who comes gets it back, plus a share of the no-shows. The event stays free for people who show up.
            Seats go to people who meant to come.
          </p>
        </div>
      </section>

      {/* Why it works */}
      <section className="space-y-5">
        <h2 className="text-3xl font-semibold tracking-tight">Why it works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            ["It filters", "People who were never coming don’t take a seat. A few dollars is enough to make “maybe” decide."],
            ["Nobody likes losing money", "Once guests put something down, they plan around the event instead of skipping it."],
            ["Showing up pays", "The deposits of people who don’t come are split among the people who do."],
          ].map(([t, d]) => (
            <div key={t} className="space-y-2">
              <div className="font-semibold text-lg">{t}</div>
              <p className="text-muted text-sm sm:text-base">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Triad */}
      <section className="grid gap-4 md:grid-cols-3">
        <Who
          title="For organizers"
          items={[
            "Firm headcount for venue and food",
            "Deposits, check-in and payouts in Telegram",
            "You never hold anyone’s money",
          ]}
        />
        <Who
          title="For sponsors"
          items={[
            "Every guest on the list put down a deposit",
            "Public list of who registered and who came",
            "Top up the pool to reward people who show up",
          ]}
        />
        <Who
          title="For guests"
          items={[
            "No more “full” from fake RSVPs",
            "Get paid a little for keeping your word",
            "Google sign-in, or pay from almost any chain",
          ]}
        />
      </section>

      {/* How you run it = tools + no crypto headache, one section */}
      <section className="space-y-5">
        <h2 className="text-3xl font-semibold tracking-tight">How you run it</h2>
        <p className="text-muted max-w-2xl">
          Deposit RSVP is the product. Telegram, your site, or Luma are just how you host — not another place guests have
          to live.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Your event page or next to Luma", "Create here, or paste a Luma link. Guests pay the deposit, then land on your usual flow."],
            ["Button on your website", "Two lines of code on Tilda, Webflow, WordPress — or one prompt for your AI agent."],
            ["Admin in Telegram", "Deposit pings, guest list, CSV, tap check-in, payout and refund confirms."],
            ["No wallet required for guests", "Google or email to sign in. Crypto users pay from almost any token. No gas dance. Funds stay in a NEAR contract."],
          ].map(([t, d]) => (
            <div key={t} className="flex gap-3 rounded-2xl border border-border p-4">
              <span className="text-good mt-0.5 shrink-0">✓</span>
              <div>
                <div className="font-medium">{t}</div>
                <p className="text-sm text-muted mt-1">{d}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Prefer the embed builder?{" "}
          <Link href="/widget" className="text-accent hover:underline">
            Get the website button
          </Link>
          .
        </p>
      </section>

      <section className="rounded-3xl border border-border p-6 sm:p-10 space-y-4 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Try it on your next event</h2>
        <p className="text-muted max-w-lg mx-auto">
          Setup takes a few minutes. Cancel anytime and every deposit goes back. We take no fee.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <PrimaryCta />
        </div>
      </section>
    </div>
  );
}

function PrimaryCta() {
  if (BOT) {
    return (
      <a href={PRIMARY_HREF} className="btn btn-accent !py-3 !px-5 inline-flex">
        {PRIMARY_LABEL}
      </a>
    );
  }
  return (
    <Link href={CREATE} className="btn btn-accent !py-3 !px-5 inline-flex">
      {PRIMARY_LABEL}
    </Link>
  );
}

function ProductFrames() {
  const steps = [
    { n: "1", title: "Guest puts down a deposit", detail: "Same amount for everyone. Google sign-in or any chain." },
    { n: "2", title: "You check them in at the door", detail: "QR scan or a tap in Telegram. On-chain attendance." },
    { n: "3", title: "Who came splits the pool", detail: "Deposit back + share of no-shows. You never hold the money." },
  ];
  return (
    <div className="rounded-3xl border border-border overflow-hidden bg-[color-mix(in_srgb,var(--border)_35%,var(--bg))]">
      <div className="px-4 py-2.5 text-xs text-muted border-b border-border">How a deposit event runs</div>
      <ol className="divide-y divide-border">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-4 p-4 sm:p-5">
            <span className="w-8 h-8 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center shrink-0 text-sm">
              {s.n}
            </span>
            <div>
              <div className="font-semibold">{s.title}</div>
              <p className="text-sm text-muted mt-0.5">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
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
