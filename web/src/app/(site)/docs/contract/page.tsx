import type { Metadata } from "next";
import { EVENTS_CONTRACT, EXPLORER_URL, NETWORK, RPC_URL, USDC_CONTRACT } from "@/lib/config";
import { Code, Ext, Mono, Next, Section, Stack, Table, Title } from "../parts";

export const metadata: Metadata = { title: "Smart Contract · Nearvent" };

const REPO = "https://github.com/AstralEX1/near-events";
const tx = (hash: string) => `${EXPLORER_URL}/txns/${hash}`;
const acc = (id: string) => `${EXPLORER_URL}/address/${id}`;

// Real transactions on the escrow this site uses; mainnet gets its own once they exist.
const PROOF: [string, string][] = NETWORK === "testnet" ? [
  ["5THM1T3rxJ2Lm2Gnmc4YSaXUgNM87poq4hbhEZuRn6U2", "Guest pays 0.1 USDC"],
  ["FNzcdnkA5KNVP8C2NXCo2bgjgy73HL9yNFbsfHbn2VmB", "Host closes: the guest came"],
  ["8shBJSzRK7aKDEHNPupzfvLY8funfvfR1fFbxkZEsp3Y", "The guest withdraws 0.1 USDC"],
  ["5ovEmf3ue62JSxkNzkY17dXWYdJM8W3pss2jDGSNydQf", "Owner upgrades the code"],
] : [];

/** The deployed code hash, read from the chain so it always matches the escrow above. */
async function codeHash(): Promise<string> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "h", method: "query", params: { request_type: "view_account", finality: "final", account_id: EVENTS_CONTRACT } }),
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    return (await res.json()).result?.code_hash ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

export default async function ContractDocs() {
  return (
    <>
      <Title lead="One Rust contract on NEAR holds every deposit and pays out by fixed rules.">Smart Contract</Title>

      <Section id="address" title="Where it lives">
        <Table
          head={["", "Account"]}
          rows={[
            ["Escrow", <Ext key="e" href={acc(EVENTS_CONTRACT)}><Mono>{EVENTS_CONTRACT}</Mono></Ext>],
            ["USDC", <Ext key="u" href={acc(USDC_CONTRACT)}><Mono>{USDC_CONTRACT}</Mono></Ext>],
            ["Code hash", <Mono key="h">{await codeHash()}</Mono>],
          ]}
        />
        <p className="text-sm text-muted">
          <Ext href={`${REPO}/blob/main/contracts/events/src/lib.rs`}>Source</Ext> · built reproducibly in CI, so you can
          rebuild it and compare the hash.
        </p>
      </Section>

      <Section id="rules" title="Money rules">
        <Stack
          items={[
            { title: "Deposit", text: "Guests who came split the whole pool. Nobody came: full refund." },
            { title: "Ticket", text: "The price goes to the host when a guest registers." },
            { title: "Publish", text: "Within 3 days after the end (by default), the host publishes who came. Nothing is paid yet." },
            { title: "Disputes", text: "For 12 hours (by default) any guest can dispute one record by locking one deposit. A council of 5 decides through a Sputnik DAO vote (3 of 5) within 7 days after the window (by default). A dispute it doesn’t decide in time expires: the list stands and the deposit goes back." },
            { title: "Payout", text: "Then anyone can settle. A wrong dispute loses its deposit: half to the treasury, half to the guests who came." },
            { title: "Cancel", text: "The host can cancel a deposit event until it publishes the list. Everyone is refunded. Cancelling a ticket event refunds nothing." },
            { title: "No list", text: "3 days after the end (by default) without a list, anyone can start the refund. The list then counts as empty, and guests who came have the dispute window to prove it. If nobody does, everyone gets the deposit back. If someone does, the guests who proved it split the pool." },
          ]}
        />
      </Section>

      <Section id="trust" title="What the host can’t do">
        <ul className="list-disc pl-5 space-y-1">
          <li>Take the deposits.</li>
          <li>Publish the list before the event ends. Before the start, the only way out is a full refund.</li>
          <li>Have the last word: any guest can dispute the list, and the council decides.</li>
          <li>Mark someone who didn’t register.</li>
          <li>Touch anyone’s balance.</li>
        </ul>
        <p className="text-sm text-muted">
          The host publishes who came, and any guest can dispute a record before the council. Deposit events close registration when they start (ticket events when they end), so the host cannot add guests after seeing who came.
        </p>
        <p className="text-sm text-muted">
          Check-ins stay off-chain, so 300 guests cost nothing. Only the final list goes on-chain. The contract account
          has no keys: only the owner can upgrade the code, and after <Mono>freeze</Mono> nobody can. Check{" "}
          <Mono>get_config</Mono> and the code hash.
        </p>
      </Section>

      <Section id="methods" title="Methods">
        <Table
          head={["Method", "Who", "Does"]}
          rows={[
            [<Mono key="1">create_event</Mono>, "Host", "Creates an event"],
            [<Mono key="2">ft_transfer_call</Mono>, "Guest", <>Pays and registers · <Mono>{`{"action":"register","event_id":N}`}</Mono></>],
            [<Mono key="2b">ft_transfer_call</Mono>, "Guest, during the dispute window", <>Opens a dispute · <Mono>{`{"action":"dispute","event_id":N,"target":"…","attended":true}`}</Mono></>],
            [<Mono key="3">finalize</Mono>, "Host, by the deadline (3 days after the end by default)", "Publishes the list of who came (ticket: closes the event)"],
            [<Mono key="3a">resolve_dispute</Mono>, "The event’s DAO", "Records the council’s verdict on one dispute"],
            [<Mono key="3a2">void_event</Mono>, "The event’s DAO, before the court deadline", "Calls the published list off: every deposit and dispute deposit goes back"],
            [<Mono key="3b">settle</Mono>, "Anyone, after the dispute window", "Pays out by the final list"],
            [<Mono key="3c">refund</Mono>, "Anyone, after that deadline", "Publishes an empty list for a host who published none"],
            [<Mono key="4">cancel</Mono>, "Host · ticket: anyone after 30 days", "Refunds every deposit (tickets: no refund)"],
            [<Mono key="4a">set_rules</Mono>, "Owner", "Court, treasury and hours for new events; running events keep theirs"],
            [<Mono key="5">withdraw</Mono>, "Anyone", "Sends out your balance"],
            [<Mono key="6">on_auth</Mono>, "NEAR Intents wallets", "Create, finalize or cancel through an auth_call intent"],
            [<Mono key="7">add_to_whitelist · set_whitelist_mode</Mono>, "Owner", "Only listed hosts create events, when on"],
            [<Mono key="7b">add_sponsored · set_sponsored_mode</Mono>, "Owner", "Free events only for listed hosts, when on"],
            [<Mono key="8">upgrade · freeze</Mono>, "Owner", "New code until freeze; freeze is forever"],
            [<Mono key="9">get_event · get_guests · balance_of · get_config</Mono>, "Anyone", "Free reads"],
          ]}
        />
        <Code>{`near contract call-function as-read-only ${EVENTS_CONTRACT} get_event \\
  json-args '{"event_id": 0}' network-config ${NETWORK} now`}</Code>
      </Section>

      <Section id="limits" title="Limits">
        <p className="text-sm">From 0.1 USDC · up to 300 guests · free up to 50 seats, 2 per host in 30 days, ending within 60 days · ends within a year.</p>
      </Section>

      {PROOF.length > 0 && (
        <Section id="proof" title="See it on-chain">
          <ul className="space-y-1 text-sm">
            {PROOF.map(([hash, label]) => <li key={hash}><Ext href={tx(hash)}>{label}</Ext></li>)}
          </ul>
        </Section>
      )}

      <Section id="build" title="Build and test">
        <Code>{`cd contracts
cargo test --locked -p near-events -p test-usdc
cargo test --locked -p near-events-sandbox
cargo near build reproducible-wasm --manifest-path events/Cargo.toml`}</Code>
      </Section>

      <Next from="/docs/contract" />
    </>
  );
}
