import type { Metadata } from "next";
import { EVENTS_CONTRACT, EXPLORER_URL, USDC_CONTRACT } from "@/lib/config";
import { Code, Ext, Mono, Next, Section, Table, Title } from "../parts";

export const metadata: Metadata = { title: "Smart Contract · Nearvent" };

const REPO = "https://github.com/AstralEX1/near-events";
const tx = (hash: string) => `${EXPLORER_URL}/txns/${hash}`;
const acc = (id: string) => `${EXPLORER_URL}/address/${id}`;

export default function ContractDocs() {
  return (
    <>
      <Title lead="All the money sits in one Rust contract on NEAR. Here is what it does, what nobody can do, and how to check it yourself.">
        Smart Contract
      </Title>

      <Section id="address" title="Where it lives">
        <Table
          head={["What", "Account"]}
          rows={[
            ["Event escrow", <Ext key="e" href={acc(EVENTS_CONTRACT)}><Mono>{EVENTS_CONTRACT}</Mono></Ext>],
            ["USDC it accepts", <Ext key="u" href={acc(USDC_CONTRACT)}><Mono>{USDC_CONTRACT}</Mono></Ext>],
            ["Code hash", <Mono key="h">G8ym7g1tSQevzz9qXHynUvRyDHnxG3iBz8zxhdZ8ZUo2</Mono>],
          ]}
        />
        <p>
          Source: <Ext href={`${REPO}/blob/main/contracts/events/src/lib.rs`}>contracts/events/src/lib.rs</Ext>. The
          WASM is built reproducibly in CI, so the code hash above can be rebuilt from the source and compared with the
          one on-chain.
        </p>
      </Section>

      <Section id="rules" title="Money rules">
        <ul className="list-disc pl-5 space-y-2">
          <li><b>Deposit events.</b> Every guest pays the same deposit. When the host closes the event with the list of who came, the whole pool is split equally between them. If nobody came, everyone is refunded. The rounding remainder (a fraction of a cent) goes to the host.</li>
          <li><b>Ticket events.</b> The ticket price goes to the host’s balance the moment a guest registers. Tickets are not refunded.</li>
          <li><b>Cancel.</b> The host can cancel a Deposit event at any time and every deposit comes back.</li>
          <li><b>Forgotten events.</b> 30 days after an event ends, anyone can cancel it if the host never closed it, and every deposit comes back.</li>
          <li><b>Balances.</b> Payouts and refunds land on your balance in the contract. You withdraw it whenever you like: to your NEAR account, or to NEAR Intents to move it to another chain.</li>
        </ul>
      </Section>

      <Section id="trust" title="What the host can and can’t do">
        <Table
          head={["The host can", "The host can’t"]}
          rows={[
            ["Create, close or cancel their own event", "Take deposits in a Deposit event"],
            ["Say who came (only registered guests count)", "Move anyone else’s balance"],
            ["Withdraw ticket money and their own balance", "Keep the pool by never closing: after 30 days anyone can refund"],
          ]}
        />
        <p className="text-sm text-muted">
          Door check-ins happen off-chain, so scanning 300 guests costs nothing. Only the final list goes on-chain, in one
          transaction. This test deployment still has a full-access key, so the team can redeploy it; the code hash shows
          exactly what runs today.
        </p>
      </Section>

      <Section id="methods" title="Methods">
        <Table
          head={["Method", "Who calls it", "What it does"]}
          rows={[
            [<Mono key="1">create_event</Mono>, "Host", "New event: title, start and end, deposit, seats, Deposit or Ticket"],
            [<Mono key="2">ft_transfer_call</Mono>, "Guest, on the USDC contract", <>Pays and registers. <Mono>msg</Mono>: <Mono>{`{"action":"register","event_id":N}`}</Mono></>],
            [<Mono key="3">finalize</Mono>, "Host", "Closes the event with the list of guests who came and splits the pool"],
            [<Mono key="4">cancel</Mono>, "Host, or anyone after 30 days", "Closes the event and refunds every deposit"],
            [<Mono key="5">withdraw</Mono>, "Anyone with a balance", "Sends your balance to you, or to your NEAR Intents account"],
            [<Mono key="6">payout_to_intents</Mono>, "Owner or our relayer", "Same, for guests who signed in with an EVM wallet; money still only goes to the owner"],
            [<Mono key="7">get_event · get_guests · balance_of</Mono>, "Anyone (free view)", "Read an event, its guests, an account’s balance"],
          ]}
        />
        <p>Read an event yourself:</p>
        <Code>{`near contract call-function as-read-only ${EVENTS_CONTRACT} get_event \\
  json-args '{"event_id": 0}' network-config testnet now`}</Code>
      </Section>

      <Section id="limits" title="Limits">
        <ul className="list-disc pl-5 space-y-1">
          <li>Deposit or ticket: at least 0.1 USDC.</li>
          <li>Up to 300 guests per event, so closing always fits in one transaction.</li>
          <li>Free for the host up to 50 seats and 2 open events; bigger events cost a little NEAR for storage (from about 0.34 NEAR).</li>
          <li>An event must end within a year, so the 30-day refund is always reachable.</li>
        </ul>
      </Section>

      <Section id="proof" title="See it work">
        <p>Real transactions from the test run of this deployment:</p>
        <ul className="list-disc pl-5 space-y-1 text-sm">
          <li><Ext href={tx("DB9MtjrsfZXB923dZTpTY6D68wW8oH1ZjWdovfmtszen")}>Guest pays a 0.1 USDC deposit</Ext></li>
          <li><Ext href={tx("7SwvaMPX9h7s5whMss8UKNdGaB4BtWbeaHK7rYR58YtH")}>Host closes the event: one guest came and gets the whole pool</Ext></li>
          <li><Ext href={tx("6gEZvogYJ35xWAUCXwbDQUzDbxmxsj8JmTAEMWCTHxo7")}>That guest withdraws 0.2 USDC</Ext></li>
          <li><Ext href={tx("2RHXieQbfLjJyRAQvdiyXHgUMLjymgoe6reh4BvCJQkZ")}>Ticket bought: money goes to the host at once</Ext></li>
        </ul>
      </Section>

      <Section id="build" title="Build and test">
        <Code>{`cd contracts
cargo test --locked -p near-events -p test-usdc   # unit tests
cargo test --locked -p near-events-sandbox        # full flows on a local NEAR node
cargo near build reproducible-wasm --manifest-path events/Cargo.toml`}</Code>
      </Section>

      <Next from="/docs/contract" />
    </>
  );
}
