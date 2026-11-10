import Link from "next/link";

// Kickback had "Getting started", an organiser guide and a FAQ. Ours, in one page.
const GUEST = [
  ["Find an event", "Open the event link from the organizer, or browse events on the home page."],
  ["Sign in", "Google or email works, no crypto needed: we create a NEAR account for you. NEAR and EVM wallets work too."],
  ["Put down the deposit", "Press Register. The deposit goes through NEAR Intents: pay with USDC from your NEAR wallet or with a supported token and network. On testnet the test USDC comes from a faucet."],
  ["Come and get checked in", "Show the QR code from the event page at the door. The host marks you as here; your payout shows once they close the event."],
  ["Withdraw", "When the host closes the event, press Withdraw on the event page: your deposit plus your share of the no-shows, sent through NEAR Intents to a supported network and wallet."],
];

const HOST = [
  ["Create the event", "Title, time, place, deposit and capacity. Add the people who will check guests in as your door team; you can change it later."],
  ["Share it", "Send the link, or put a card or button on your own website from the “For your website” page."],
  ["Check people in", "On the event day open Manage, press “Scan QR codes” and scan guests, then press Check in. Search works too. Marks are saved on Near Me, no transaction per guest."],
  ["Close the event", "Review the final door list, then close the event. Deposits are credited to checked-in guests’ Near Me balances; if nobody was checked in, deposits are refunded there. Paid ticket money goes to the host’s balance as each guest registers."],
];

const FAQ = [
  ["Who holds the money?", "A NEAR smart contract holds it, and releases it according to the event’s payment rules. Every deposit, the final list of who came and every payout are public on-chain."],
  ["Is there a fee?", "Near Me has no platform fee. Deposit pools go to checked-in guests; ticket revenue goes to the host. Network and swap fees may still apply."],
  ["Can I cancel after registering?", "No. That is what makes people come. If the host cancels, everyone gets their deposit back."],
  ["What if the host forgets to close the event?", "30 days after it ends, anyone can trigger a full refund to every guest."],
  ["What if I came but wasn’t checked in?", "Tell the host before they close the event; they can still check you in. A photo from the event helps."],
  ["Why USDC?", "So the deposit is worth the same at the door as when you paid it."],
  ["Is there a time limit to withdraw?", "No. Your payout stays in your balance until you withdraw it."],
];

export default function Guide() {
  return (
    <div className="max-w-3xl space-y-12">
      <div>
        <h1 className="gc-page-title">How Near Me works</h1>
        <p className="text-muted mt-2">A few things to know before your next get-together.</p>
      </div>
      <Steps id="guests" title="Going to an event" items={GUEST} />
      <Steps id="hosts" title="Hosting an event" items={HOST} />
      <section id="faq">
        <h2 className="text-xl font-semibold mb-4">FAQ</h2>
        <div className="space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="card px-4 py-3 group">
              <summary className="font-medium cursor-pointer list-none flex items-center justify-between gap-3">
                {q}
                <span className="text-muted group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-sm text-muted mt-2">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <div className="flex gap-3">
        <Link href="/events" className="btn btn-primary">Browse events</Link>
        <Link href="/create" className="btn btn-ghost">Host an event</Link>
      </div>
    </div>
  );
}

function Steps({ id, title, items }: { id: string; title: string; items: string[][] }) {
  return (
    <section id={id}>
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <ol className="space-y-3">
        {items.map(([t, d], i) => (
          <li key={t} className="flex gap-4">
            <span className="w-8 h-8 shrink-0 rounded-full bg-accent-soft text-accent font-semibold flex items-center justify-center">{i + 1}</span>
            <div>
              <div className="font-medium">{t}</div>
              <p className="text-sm text-muted">{d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
