// DAO as host, on testnet: a Sputnik DAO creates an event, sponsors its pool from
// the treasury, and (later) finalizes the payout — each step a DAO proposal.
//
//   node scripts/dao-demo.mjs setup      # create DAO, fund it, propose+approve create_event and a 10 USDC bonus
//   node scripts/dao-demo.mjs finalize N  # propose+approve finalize(event N)
//
// Keys are read from ~/.near-credentials (never printed).
// Env: EVENTS_CONTRACT, USDC_CONTRACT, HOST_ACCOUNT (DAO council), GUEST_ACCOUNT (co-host), DAO_NAME
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const env = (k, d) => process.env[k] ?? d ?? (() => { throw new Error(`Set ${k}`); })();
const EVENTS = env("EVENTS_CONTRACT");
const USDC = env("USDC_CONTRACT");
const HOST = env("HOST_ACCOUNT");
const COHOST = env("GUEST_ACCOUNT");
const FACTORY = "sputnik-v2.testnet";
const DAO = `${env("DAO_NAME", "nearevents-community")}.${FACTORY}`;
const NEAR = 10n ** 24n;
const TGAS = 10n ** 12n;

const provider = new JsonRpcProvider({ url: "https://rpc.testnet.near.org" });
const host = new Account(
  HOST,
  provider,
  JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${HOST}.json`, "utf8")).private_key,
);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

async function exists(accountId) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch {
    return false;
  }
}

/** Adds a FunctionCall proposal and approves it with the (single-member) council. */
async function propose(description, receiver_id, method_name, args, deposit = 0n, gas = 150n * TGAS) {
  const policy = await view(DAO, "get_policy");
  const kind = {
    FunctionCall: {
      receiver_id,
      actions: [{ method_name, args: b64(args), deposit: deposit.toString(), gas: gas.toString() }],
    },
  };
  await host.callFunction({
    contractId: DAO,
    methodName: "add_proposal",
    args: { proposal: { description, kind } },
    deposit: BigInt(policy.proposal_bond),
    gas: 50n * TGAS,
  });
  const id = (await view(DAO, "get_last_proposal_id")) - 1;
  await host.callFunction({
    contractId: DAO,
    methodName: "act_proposal",
    args: { id, action: "VoteApprove", proposal: kind },
    gas: 300n * TGAS,
  });
  const p = await view(DAO, "get_proposal", { id });
  console.log(`proposal ${id} (${method_name}): ${p.status}`);
  if (p.status !== "Approved") throw new Error(`Proposal ${id} did not pass`);
  return id;
}

async function setup() {
  if (!(await exists(DAO))) {
    await host.callFunction({
      contractId: FACTORY,
      methodName: "create",
      args: {
        name: DAO.split(".")[0],
        args: b64({
          config: { name: DAO.split(".")[0], purpose: "Community that hosts Near Events meetups", metadata: "" },
          policy: [HOST],
        }),
      },
      deposit: 6n * NEAR,
      gas: 300n * TGAS,
    });
    console.log("created DAO", DAO);
  }
  // Treasury: a little NEAR for event storage, and test USDC for the sponsor bonus.
  await host.transfer({ receiverId: DAO, amount: NEAR });
  await host.callFunction({ contractId: USDC, methodName: "mint", args: { amount: "10000000", account_id: DAO }, gas: 30n * TGAS });

  const storage = BigInt(await view(EVENTS, "storage_cost", { capacity: 30 }));
  const start = new Date(Date.now() + 5 * 24 * 3600_000);
  start.setHours(19, 0, 0, 0);
  await propose("Host the November community meetup", EVENTS, "create_event", {
    metadata: {
      title: "Community DAO Meetup",
      description:
        "Hosted by the nearevents-community DAO. The DAO voted to add a 10 USDC bonus to the pool from its treasury. Our co-host checks everyone in at the door; the DAO votes to pay out.",
      location: "Online · link sent to registered guests",
      cover_url: null,
      starts_at: start.getTime(),
      ends_at: start.getTime() + 2 * 3600_000,
    },
    deposit: "5000000",
    capacity: 30,
    cohosts: [COHOST],
  }, storage);
  const eventId = (await view(EVENTS, "get_events_count")) - 1;
  console.log("DAO event", eventId, (await view(EVENTS, "get_event", { event_id: eventId })).host);

  await propose("Sponsor the meetup pool with 10 USDC", USDC, "ft_transfer_call", {
    receiver_id: EVENTS,
    amount: "10000000",
    msg: JSON.stringify({ action: "sponsor", event_id: eventId }),
  }, 1n);
  console.log("bonus pool", (await view(EVENTS, "get_event", { event_id: eventId })).bonus_pool);
}

async function finalize(eventId) {
  await propose(`Pay out event ${eventId}`, EVENTS, "finalize", { event_id: eventId }, 1n, 250n * TGAS);
  console.log(JSON.stringify(await view(EVENTS, "get_event", { event_id: eventId })));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "setup") await setup();
else if (cmd === "finalize") await finalize(Number(arg));
else console.log("usage: dao-demo.mjs setup | finalize <event_id>");
