import type { Metadata } from "next";
import Link from "next/link";
import { EXPLORER_URL } from "@/lib/config";
import { hoursText } from "@/lib/near";
import { escrowRules } from "../escrowRules";
import { Ext, Faq, Mono, Next, Section, Shot, Stack, Table, Title } from "../parts";

export const metadata: Metadata = { title: "Disputes & DAO · Nearvent" };

export default async function DisputeDocs() {
  const rules = await escrowRules();
  const dao = rules?.dao ?? null;
  const win = hoursText(rules?.challenge_hours ?? 12);
  const resolve = hoursText(rules?.resolve_hours ?? 168);
  const bond = rules?.bond_per_seat ?? 0;
  return (
    <>
      <Title lead="The host says who came. A guest who disagrees can dispute it, and a DAO council decides.">Disputes & DAO</Title>

      <div className="card px-5 py-4 mb-12 space-y-1">
        <div className="flex items-center gap-2 font-medium">
          <span className="gc-chip" data-tone={dao ? "good" : undefined}>{dao ? "Court on" : "Court off"}</span>
          {dao ? "For deposit events created from now on" : "The host’s list is final on this escrow"}
        </div>
        {dao ? (
          <p className="text-sm text-muted">
            Council: <Ext href={`https://sputnik-dao.trezu.org/${dao}`}><Mono>{dao}</Mono></Ext> · <Ext href={`${EXPLORER_URL}/address/${dao}`}>NearBlocks</Ext>.
            Each event keeps the rules it was created with, so earlier events stay without a court.
          </p>
        ) : (
          <p className="text-sm text-muted">The owner turns the court on with <Mono>set_rules</Mono>. Only events created after that get it.</p>
        )}
      </div>

      <Section id="flow" title="How a dispute works">
        <div className="space-y-12">
          <Shot n={1} title="The host publishes who came" images={[{ src: "/docs/checkin.png", w: 1840, h: 156, alt: "Guest marked as checked in at the door" }]}>
            After the event, from the door check-ins. Nothing is paid yet.
          </Shot>
          <Shot n={2} title="Not on the list? Dispute it" images={[{ src: "/docs/dispute.png", w: 1256, h: 570, alt: "You’re not on the host’s list: I Came, Open a Dispute" }]}>
            For {win} any guest can dispute one record: “I came” or “they didn’t”. It locks one deposit.
          </Shot>
          <Shot n={3} title="The council decides" images={[{ src: "/docs/council.png", w: 1256, h: 1454, alt: "Dispute waiting for the council, with the door check-in log" }]}>
            Our bot opens a vote in the DAO with a link to the door log. 3 council votes decide, within {resolve} after the window.
          </Shot>
          <Shot n={4} title="Anyone settles" images={[{ src: "/docs/payout.png", w: 1304, h: 1030, alt: "Payout ready to withdraw" }]}>
            Payouts follow the final list. Nobody votes if nobody disputes.
          </Shot>
        </div>
      </Section>

      <Section id="outcomes" title="Who gets what">
        <Table
          head={["The council", "The guest who disputed"]}
          rows={[
            ["Agrees", "Gets the deposit back, plus the payout if they came"],
            ["Disagrees", "Loses the deposit: half to the treasury, half to the guests who came"],
            ["Doesn’t decide in time", "Gets the deposit back; the host’s list stands"],
            ["Cancels the event", "Everyone gets their deposit back, dispute deposits too"],
          ]}
        />
      </Section>

      <Section id="oracle" title="An optimistic oracle">
        <Stack
          items={[
            {
              title: "True unless challenged",
              text: `The host’s list is a claim. If nobody disputes it within ${win}, it is final.`,
              tech: `finalize → Submitted · challenge window ${rules?.challenge_hours ?? 12} h · settle`,
            },
            {
              title: "The court is on-chain",
              text: "The escrow takes a verdict only from the event’s own DAO, through an approved proposal. Not from us, not from the host.",
              tech: "Sputnik DAO v2 · FunctionCall resolve_dispute / void_event",
            },
            {
              title: "The evidence can’t change",
              text: "The door log only grows and freezes when the list is published. Every DAO proposal carries its hash.",
              tech: "/api/checkin?log=1 · door log sha256 in the proposal",
            },
            {
              title: "A bot does the paperwork",
              text: "Our keeper opens the votes and settles after the deadline. Anyone can do the same by hand.",
              tech: "keeper · add_proposal · settle (permissionless)",
            },
          ]}
        />
      </Section>

      <Section id="safeguards" title="Safeguards">
        <ul className="list-disc pl-5 space-y-1">
          <li>A lost dispute costs a deposit, so spam isn’t free.</li>
          <li>One “they didn’t come” claim per guest per event.</li>
          <li>Registration closes at the start: the host can’t add friends after seeing who came.</li>
          <li>Each event copies the rules when it is created. The owner can’t change a running event.</li>
          <li>The court DAO and the treasury can’t host events.</li>
          <li>
            {bond > 0
              ? `The host locks a bond of ${bond} deposit${bond === 1 ? "" : "s"} per seat. If a dispute is upheld, it pays the guests who won.`
              : "A host bond can be switched on for new events: it pays the guests who win a dispute. It is off now."}
          </li>
        </ul>
      </Section>

      <Section id="dao-host" title="A DAO can host too">
        <p>
          Any Sputnik DAO (<Mono>*.sputnik-dao.near</Mono>) can host events. Its council runs Manage and the door, and
          publishing or cancelling become DAO proposals. The deposits stay in the escrow and go to the guests who came.
        </p>
      </Section>

      <Section id="faq" title="FAQ">
        <Faq
          items={[
            ["Who is on the council?", "The members of the court DAO. 3 votes decide, and every vote is public in the DAO."],
            ["Does every event have a court?", "Deposit events created while the court is on. Tickets and free events don’t need one."],
            ["What if the council never votes?", `${resolve} after the window, open disputes expire: the list stands and every dispute deposit comes back.`],
            ["Can I dispute from MetaMask?", "Yes, with one signature through NEAR Intents. You need one deposit of USDC in your NEAR Intents balance."],
            ["Can the council take the money?", "No. It can only say who came or cancel the event. The escrow pays the guests."],
          ]}
        />
        <p className="text-sm text-muted">
          Methods and money rules: <Link href="/docs/contract" className="text-accent underline">Smart Contract</Link>.
        </p>
      </Section>

      <Next from="/docs/disputes" />
    </>
  );
}
