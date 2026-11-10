import type { Metadata } from "next";
import { EVENTS_CONTRACT, EXPLORER_URL, USDC_CONTRACT } from "@/lib/config";
import { Code, Ext, Mono, Next, Section, Stack, Table, Title } from "../parts";

export const metadata: Metadata = { title: "Smart Contract · Nearvent" };

const REPO = "https://github.com/AstralEX1/near-events";
const tx = (hash: string) => `${EXPLORER_URL}/txns/${hash}`;
const acc = (id: string) => `${EXPLORER_URL}/address/${id}`;

export default function ContractDocs() {
  return (
    <>
      <Title lead="One Rust contract on NEAR holds every deposit and pays out by fixed rules.">Smart Contract</Title>

      <Section id="address" title="Where it lives">
        <Table
          head={["", "Account"]}
          rows={[
            ["Escrow", <Ext key="e" href={acc(EVENTS_CONTRACT)}><Mono>{EVENTS_CONTRACT}</Mono></Ext>],
            ["USDC", <Ext key="u" href={acc(USDC_CONTRACT)}><Mono>{USDC_CONTRACT}</Mono></Ext>],
            ["Code hash", <Mono key="h">G8ym7g1tSQevzz9qXHynUvRyDHnxG3iBz8zxhdZ8ZUo2</Mono>],
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
            { title: "Cancel", text: "The host can cancel a deposit event any time. Everyone is refunded." },
            { title: "Safety valve", text: "30 days after the end, anyone can refund an event the host never closed." },
          ]}
        />
      </Section>

      <Section id="trust" title="What the host can’t do">
        <ul className="list-disc pl-5 space-y-1">
          <li>Take the deposits.</li>
          <li>Mark someone who didn’t register.</li>
          <li>Touch anyone’s balance.</li>
        </ul>
        <p className="text-sm text-muted">
          Check-ins stay off-chain, so 300 guests cost nothing. Only the final list goes on-chain. This test deployment
          keeps a full-access key so the team can redeploy; the code hash shows what runs today.
        </p>
      </Section>

      <Section id="methods" title="Methods">
        <Table
          head={["Method", "Who", "Does"]}
          rows={[
            [<Mono key="1">create_event</Mono>, "Host", "Creates an event"],
            [<Mono key="2">ft_transfer_call</Mono>, "Guest", <>Pays and registers · <Mono>{`{"action":"register","event_id":N}`}</Mono></>],
            [<Mono key="3">finalize</Mono>, "Host", "Closes with the list of who came"],
            [<Mono key="4">cancel</Mono>, "Host · anyone after 30 days", "Refunds everyone"],
            [<Mono key="5">withdraw</Mono>, "Anyone", "Sends out your balance"],
            [<Mono key="6">get_event · get_guests · balance_of</Mono>, "Anyone", "Free reads"],
          ]}
        />
        <Code>{`near contract call-function as-read-only ${EVENTS_CONTRACT} get_event \\
  json-args '{"event_id": 0}' network-config testnet now`}</Code>
      </Section>

      <Section id="limits" title="Limits">
        <p className="text-sm">From 0.1 USDC · up to 300 guests · free up to 50 seats · ends within a year.</p>
      </Section>

      <Section id="proof" title="See it on-chain">
        <ul className="space-y-1 text-sm">
          <li><Ext href={tx("DB9MtjrsfZXB923dZTpTY6D68wW8oH1ZjWdovfmtszen")}>Guest pays 0.1 USDC</Ext></li>
          <li><Ext href={tx("7SwvaMPX9h7s5whMss8UKNdGaB4BtWbeaHK7rYR58YtH")}>Host closes: one guest came</Ext></li>
          <li><Ext href={tx("6gEZvogYJ35xWAUCXwbDQUzDbxmxsj8JmTAEMWCTHxo7")}>That guest withdraws the whole 0.2 USDC pool</Ext></li>
        </ul>
      </Section>

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
