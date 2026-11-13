// Testnet rehearsal of escrow v3 with a real Sputnik DAO (sputnikv2.testnet).
// Needs an escrow built with `--features short-windows` (one oracle hour = 10 s).
// Run the steps in order; each step records its transactions in LOG (JSON lines):
//   node scripts/smoke-v3-testnet.mjs dao | events | publish | disputes | votes | late | check
// The keeper (proposals, settle, refund) runs between steps with scripts/keeper-once.mjs.
// Keys come from ~/.near-credentials/testnet (disposable demo accounts); never printed.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider } from "near-api-js";

const ESCROW = process.env.ESCROW ?? "oracle-v3.atia-nv1109.testnet";
const USDC = "usdc.tidepool-sandbox.testnet";
const FACTORY = "sputnikv2.testnet";
const DAO_NAME = process.env.DAO_NAME ?? "nearvent-court-v3";
const DAO = `${DAO_NAME}.${FACTORY}`;
const STATE = process.env.STATE ?? "v3-testnet-state.json";
const LOG = process.env.LOG ?? "v3-testnet.jsonl";
const D = 1_000_000n; // 1 test USDC
const n = (s) => `${s}.testnet`;
const OWNER = process.env.OWNER_ACCOUNT ?? n("atia-nv1109");
const COUNCIL = ["steve-nv1109", "chawki-nv1109", "jacqueline-nv1109", "tp6guest1-nv1110", "tp6host-nv1110"].map(n);
const BOT = n("relayer-nearevents-11022103");
const [HOST_A, HOST_B] = [n("yusak-nv1109"), n("alexandre-nv1109")];
/** The default rules with the rehearsal court. */
const COURT_RULES = { dao: DAO, treasury: OWNER, bond_per_seat: 2, close_at_start: true, challenge_hours: 12, submit_hours: 72, resolve_hours: 168 };
const [STAN, HEBERT, G2] = [n("stan-nv1109"), n("hebert-nv1109"), n("tp6guest2-nv1110")];

const provider = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 1));
const account = (id) => new Account(id, provider, JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${id}.json`, "utf8")).private_key);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One function call; logs its hash and whether any receipt failed. */
async function tx(label, signer, contractId, methodName, args, { deposit = 0n, gas = 100_000_000_000_000n, expectFailure = false } = {}) {
  let outcome, failures;
  try {
    outcome = await account(signer).callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" });
    failures = [outcome.status, ...outcome.receipts_outcome.map((r) => r.outcome.status)]
      .map((s) => s?.Failure).filter(Boolean).map((f) => JSON.stringify(f).match(/panicked: ([^"\\]+)|"(ERR_[A-Z_]+)/)?.slice(1).find(Boolean) ?? JSON.stringify(f).slice(0, 160));
  } catch (e) {
    // near-api-js throws when the first receipt fails; the transaction still landed.
    if (!/panicked|ExecutionError/.test(e.message)) throw e;
    outcome = { transaction: { hash: e.transactionResult?.transaction?.hash ?? `(block ${e.blockHash})` } };
    failures = [e.message.replace(/^.*panicked at '?/, "").slice(0, 120)];
  }
  const entry = { at: new Date().toISOString(), label, signer, contract: contractId, method: methodName, hash: outcome.transaction.hash, failed: failures };
  appendFileSync(LOG, JSON.stringify(entry) + "\n");
  console.log(`${failures.length ? "✗" : "✓"} ${label}  ${outcome.transaction.hash}${failures.length ? `  (${failures.join("; ")})` : ""}`);
  // expectFailure: null = either is fine (the caller checks the result).
  if (expectFailure === false && failures.length) throw new Error(`${label} failed: ${failures.join("; ")}`);
  if (expectFailure === true && !failures.length) throw new Error(`${label} was expected to fail`);
  return outcome;
}

const pay = (label, signer, amount, msg, opts) =>
  tx(label, signer, USDC, "ft_transfer_call", { receiver_id: ESCROW, amount: amount.toString(), msg: JSON.stringify(msg) }, { deposit: 1n, gas: 150_000_000_000_000n, ...opts });
const usdcOf = async (id) => BigInt(await view(USDC, "ft_balance_of", { account_id: id }));
const escrowOf = async (id) => BigInt(await view(ESCROW, "balance_of", { account_id: id }));
const event = (id) => view(ESCROW, "get_event", { event_id: id });

async function proposalId(tag) {
  const last = await view(DAO, "get_last_proposal_id");
  const all = await view(DAO, "get_proposals", { from_index: Math.max(0, last - 100), limit: 100 });
  return all.find((p) => p.description.startsWith(tag))?.id;
}

/** Votes until the proposal leaves InProgress (rerunnable). The vote that executes a
 * refused call shows the escrow's panic in its receipts; the DAO marks the proposal Failed. */
async function vote(label, pid, action, voters) {
  const proposal = await view(DAO, "get_proposal", { id: pid });
  for (const member of voters) {
    const now = await view(DAO, "get_proposal", { id: pid });
    if (now.status !== "InProgress") break;
    if (now.votes?.[member]) continue;
    const out = await tx(`${label}: ${member} ${action}`, member, DAO, "act_proposal", { id: pid, action, proposal: proposal.kind }, { gas: 300_000_000_000_000n, expectFailure: null });
    void out;
  }
  const { status } = await view(DAO, "get_proposal", { id: pid });
  console.log(`  proposal ${pid} → ${status}`);
  return status;
}

const tag = (eventId, target, upheld) => `nearvent:dispute:${ESCROW}:${eventId}:${target}:${upheld ? "uphold" : "dismiss"}`;

const steps = {
  async dao() {
    const policy = JSON.parse(readFileSync(new URL("../../docs/oracle-upgrade/evidence/dao-policy-v3.json", import.meta.url), "utf8"));
    policy.roles[0].kind.Group = COUNCIL;
    policy.roles[1].kind.Group = [BOT];
    const args = Buffer.from(JSON.stringify({ config: { name: DAO_NAME, purpose: "Nearvent attendance disputes (testnet rehearsal, 3 of 5)", metadata: "" }, policy })).toString("base64");
    await tx("create the DAO", n("carissan-nv1109"), FACTORY, "create", { name: DAO_NAME, args }, { deposit: 6_000_000_000_000_000_000_000_000n, gas: 300_000_000_000_000n });
    assert.equal(await view(DAO, "version"), "2.3.1");
    console.log("factory info", await view(DAO, "get_factory_info"));
    // SPEC F5 step 4: the factory's keys must not be able to replace the DAO's code.
    const kind = { FactoryInfoUpdate: { factory_info: { factory_id: FACTORY, auto_update: false } } };
    await tx("propose: factory auto-update off", COUNCIL[0], DAO, "add_proposal", { proposal: { description: "Disable factory auto-update", kind } }, { gas: 100_000_000_000_000n });
    const pid = (await view(DAO, "get_last_proposal_id")) - 1;
    assert.equal(await vote("auto-update off", pid, "VoteApprove", COUNCIL.slice(0, 3)), "Approved");
    const info = await view(DAO, "get_factory_info");
    assert.equal(info.auto_update, false);
    await tx("set_rules (court)", OWNER, ESCROW, "set_rules", { rules: COURT_RULES }, { deposit: 1n });
    console.log("config", await view(ESCROW, "get_config"));
  },

  async events() {
    const now = Date.now();
    const meta = (title) => ({ title, starts_at: now + 60_000, ends_at: now + 240_000 });
    const create = async (label, host) => {
      const out = await tx(`create ${label}`, host, ESCROW, "create_event", { metadata: meta(`v3 rehearsal ${label}`), deposit: D.toString(), capacity: 10 });
      return JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString());
    };
    state.A = await create("A (disputes)", HOST_A);
    state.B = await create("B (expiry)", HOST_B);
    state.C = await create("C (abandoned)", HOST_A);
    save();
    // Before the bond the seat is refused and the USDC comes back.
    const before = await usdcOf(HEBERT);
    await pay("register before the bond (refused)", HEBERT, D, { action: "register", event_id: state.A });
    assert.equal(await usdcOf(HEBERT), before);
    for (const [id, host] of [[state.A, HOST_A], [state.B, HOST_B], [state.C, HOST_A]]) {
      await pay(`host bond for ${id}`, host, 5n * D, { action: "host_bond", event_id: id });
      assert.equal((await event(id)).host_bond, (5n * D).toString());
    }
    // The host cannot take a seat.
    const hostBefore = await usdcOf(HOST_A);
    await pay("host registers (refused)", HOST_A, D, { action: "register", event_id: state.A });
    assert.equal(await usdcOf(HOST_A), hostBefore);
    for (const [id, guests] of [[state.A, [STAN, HEBERT, G2]], [state.B, [STAN, HEBERT]], [state.C, [STAN, G2]]]) {
      for (const g of guests) await pay(`register ${g} for ${id}`, g, D, { action: "register", event_id: id });
      assert.equal((await event(id)).guest_count, guests.length);
    }
    console.log("events", state, "end at", new Date(now + 240_000).toISOString());
  },

  async publish() {
    const a = await event(state.A);
    while (Date.now() < a.metadata.ends_at + 5_000) await sleep(5_000);
    await tx("publish A: stan, g2 (hebert left off)", HOST_A, ESCROW, "finalize", { event_id: state.A, attended: [STAN, G2] }, { deposit: 1n, gas: 100_000_000_000_000n });
    await tx("publish B: stan (hebert left off)", HOST_B, ESCROW, "finalize", { event_id: state.B, attended: [STAN] }, { deposit: 1n, gas: 100_000_000_000_000n });
    for (const id of [state.A, state.B]) {
      const e = await event(id);
      assert.equal(e.status, "Submitted");
      console.log(id, "challenge ends", new Date(e.challenge_ends_at).toISOString(), "resolve by", new Date(e.resolve_by).toISOString());
    }
    console.log("C stays unpublished; refund after", new Date((await event(state.C)).submit_by).toISOString());
  },

  async disputes() {
    await pay("A: hebert says he came", HEBERT, D, { action: "dispute", event_id: state.A, target: HEBERT, attended: true });
    await pay("A: stan says g2 did not come", STAN, D, { action: "dispute", event_id: state.A, target: G2, attended: false });
    await pay("B: hebert says he came", HEBERT, D, { action: "dispute", event_id: state.B, target: HEBERT, attended: true });
    // Rules the escrow enforces: one dispute per record; "I came" only for yourself.
    const before = await usdcOf(STAN);
    await pay("A: second dispute on hebert's record (refused)", STAN, D, { action: "dispute", event_id: state.A, target: HEBERT, attended: true }, { expectFailure: true });
    assert.equal(await usdcOf(STAN), before, "the refused dispute's USDC came back");
    console.log("A disputes", await view(ESCROW, "get_disputes", { event_id: state.A }));
  },

  async votes() {
    // The council: three Approve on the right verdict makes the DAO call the escrow.
    const upheld = await proposalId(tag(state.A, HEBERT, true));
    assert.equal(await vote("A hebert uphold", upheld, "VoteApprove", COUNCIL.slice(0, 3)), "Approved");
    // The opposite proposal, approved anyway: the escrow refuses the second verdict.
    assert.equal(await vote("A hebert dismiss (second verdict)", await proposalId(tag(state.A, HEBERT, false)), "VoteApprove", COUNCIL.slice(2, 5)), "Failed");
    assert.equal(await vote("A g2 uphold", await proposalId(tag(state.A, G2, true)), "VoteReject", COUNCIL.slice(0, 3)), "Rejected");
    assert.equal(await vote("A g2 dismiss", await proposalId(tag(state.A, G2, false)), "VoteApprove", COUNCIL.slice(1, 4)), "Approved");
    // The bot may only propose.
    await tx("bot votes (refused)", BOT, DAO, "act_proposal", { id: await proposalId(tag(state.B, HEBERT, true)), action: "VoteApprove", proposal: (await view(DAO, "get_proposal", { id: await proposalId(tag(state.B, HEBERT, true)) })).kind }, { gas: 100_000_000_000_000n, expectFailure: true });
    const e = await event(state.A);
    assert.deepEqual([e.open_disputes, e.upheld_disputes, e.dismissed_disputes, e.attended_count], [0, 1, 1, 3]);
    console.log("A disputes", await view(ESCROW, "get_disputes", { event_id: state.A }));
  },

  async late() {
    // B's dispute stayed undecided; after resolve_by a verdict is refused.
    const b = await event(state.B);
    while (Date.now() < b.resolve_by + 5_000) await sleep(10_000);
    assert.equal(await vote("B hebert uphold after resolve_by", await proposalId(tag(state.B, HEBERT, true)), "VoteApprove", COUNCIL.slice(0, 3)), "Failed");
  },

  async check() {
    const show = (x) => (Number(x) / 1e6).toFixed(6);
    const want = {
      [STAN]: 1_166_666n + 2_000_000n + 2_250_000n,
      [HEBERT]: 4_666_666n + 1_000_000n,
      [G2]: 1_166_666n + 2_250_000n,
      [HOST_B]: 5_000_000n,
      [HOST_A]: 0n,
      [OWNER]: 3_000_002n + 2_500_000n,
    };
    let owed = 0n;
    for (const [who, amount] of Object.entries(want)) {
      const got = await escrowOf(who);
      owed += got;
      console.log(`${who.padEnd(34)} ${show(got)} USDC (expected ${show(amount)})`);
      assert.equal(got, amount, who);
    }
    for (const id of [state.A, state.B, state.C]) console.log(id, (await event(id)).status);
    assert.equal((await event(state.A)).status, "Finalized");
    assert.equal((await event(state.B)).status, "Finalized");
    assert.equal((await event(state.C)).status, "Refunded");
    const held = await usdcOf(ESCROW);
    console.log("escrow holds", show(held), "USDC; balances owed", show(owed));
    assert.equal(held, owed, "money in = money out");
    // A payout leaves the escrow with a normal withdraw.
    const before = await usdcOf(HEBERT);
    await tx("hebert withdraws", HEBERT, ESCROW, "withdraw", { amount: null, receiver_id: null, to_intents: null }, { deposit: 1n, gas: 100_000_000_000_000n });
    assert.equal(await usdcOf(HEBERT), before + want[HEBERT]);
  },
};

// Second escrow (final code): the host abandons, anyone opens the window on an
// empty list, a guest who came proves it, the council agrees, settle.
const HOST_X = HEBERT;
steps.abandon = async () => {
  if (!(await view(ESCROW, "get_config")).rules?.dao) await tx("set_rules (court)", OWNER, ESCROW, "set_rules", { rules: COURT_RULES }, { deposit: 1n });
  const now = Date.now();
  const out = await tx("create X (abandoned, then proven)", HOST_X, ESCROW, "create_event", { metadata: { title: "v3 rehearsal X", starts_at: now + 60_000, ends_at: now + 180_000 }, deposit: D.toString(), capacity: 10 });
  state.X = JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString());
  save();
  await pay(`host bond for ${state.X}`, HOST_X, 5n * D, { action: "host_bond", event_id: state.X });
  for (const g of [STAN, G2]) await pay(`register ${g} for ${state.X}`, g, D, { action: "register", event_id: state.X });
  const e = await event(state.X);
  console.log("X", state.X, "ends", new Date(e.metadata.ends_at).toISOString(), "submit_by", new Date(e.submit_by).toISOString());
};
steps["abandon-dispute"] = async () => {
  const e = await event(state.X);
  assert.deepEqual([e.status, e.abandoned, e.attended_count], ["Submitted", true, 0]);
  await pay("X: stan says he came", STAN, D, { action: "dispute", event_id: state.X, target: STAN, attended: true });
};
steps["abandon-votes"] = async () => {
  assert.equal(await vote("X stan uphold", await proposalId(tag(state.X, STAN, true)), "VoteApprove", COUNCIL.slice(0, 3)), "Approved");
};
steps["abandon-check"] = async () => {
  const e = await event(state.X);
  assert.equal(e.status, "Finalized");
  // Pool 2 to stan, his bond back and the winner's half of the 5 USDC bond; g2 nothing; treasury 2.5.
  const want = { [STAN]: 2_000_000n + 1_000_000n + 2_500_000n, [G2]: 0n, [HOST_X]: 0n, [OWNER]: 2_500_000n };
  for (const [who, amount] of Object.entries(want)) {
    const got = await escrowOf(who);
    console.log(`${who.padEnd(34)} ${(Number(got) / 1e6).toFixed(6)} USDC (expected ${(Number(amount) / 1e6).toFixed(6)})`);
    assert.equal(got, amount, who);
  }
  assert.equal(await usdcOf(ESCROW), Object.values(want).reduce((a, b) => a + b, 0n), "money in = money out");
};

// Site demo (one dispute cycle to watch on the local site, ESCROW=oracle-v3b…):
//   demo → demo-bond → demo-checkin → demo-late → demo-publish → demo-dispute → keeper → demo-votes → keeper → demo-check
// Host carissan publishes stan and g2 but leaves off hebert, who came and was checked in; hebert proves it.
const DEMO_HOST = process.env.DEMO_HOST ?? n("carissan-nv1109");
const SITE = process.env.SITE ?? "http://localhost:3000";
const DEMO_PEOPLE = [STAN, HEBERT, G2, DEMO_HOST, OWNER];
steps.demo = async () => {
  const capacity = Number(process.env.DEMO_CAPACITY ?? 4);
  // The bond is 2 deposits per seat (COURT_RULES); the top-up only has to cover it.
  const bond = 2n * BigInt(capacity) * D;
  if ((await usdcOf(DEMO_HOST)) < bond) {
    const reg = await view(USDC, "storage_balance_of", { account_id: DEMO_HOST });
    if (!reg) await tx("USDC storage for the demo host", BOT, USDC, "storage_deposit", { account_id: DEMO_HOST, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n });
    await tx("top up the demo host's USDC for the bond", BOT, USDC, "ft_transfer", { receiver_id: DEMO_HOST, amount: bond.toString() }, { deposit: 1n });
  }
  const now = Date.now();
  const minutes = Number(process.env.DEMO_MINUTES ?? 10);
  const startIn = Number(process.env.DEMO_START_MINUTES ?? 1.5) * 60_000;
  const out = await tx("create the demo event", DEMO_HOST, ESCROW, "create_event", { metadata: { title: "Nearvent V3 demo: dispute cycle", starts_at: now + startIn, ends_at: now + minutes * 60_000 }, deposit: D.toString(), capacity });
  state.demo = JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString());
  state.demoBefore = Object.fromEntries(await Promise.all(DEMO_PEOPLE.map(async (a) => [a, (await escrowOf(a)).toString()])));
  // Other events that may still pay these people would blur the balance deltas below.
  state.demoOthers = (await view(ESCROW, "get_events", { from_index: 0, limit: 100 }))
    .filter((x) => x.id !== state.demo && ["Open", "Submitted"].includes(x.status) && (x.guest_count > 0 || x.host_bond !== "0")).map((x) => x.id);
  save();
  const e = await event(state.demo);
  console.log("demo event", state.demo, `${SITE}/e/${state.demo}`, "starts", new Date(e.metadata.starts_at).toISOString(), "ends", new Date(e.metadata.ends_at).toISOString(), "bond", e.host_bond);
};
steps["demo-bond"] = async () => {
  const before = await usdcOf(HEBERT);
  await pay("register before the bond (refused)", HEBERT, D, { action: "register", event_id: state.demo });
  assert.equal(await usdcOf(HEBERT), before, "the refused registration's USDC came back");
  const bond = (await event(state.demo)).bond_due;
  await pay(`host bond for ${state.demo} (${Number(bond) / 1e6} USDC, ${(await event(state.demo)).rules.bond_per_seat} deposits per seat)`, DEMO_HOST, BigInt(bond), { action: "host_bond", event_id: state.demo });
  for (const g of [STAN, HEBERT, G2]) await pay(`register ${g} for ${state.demo}`, g, D, { action: "register", event_id: state.demo });
  const e = await event(state.demo);
  assert.deepEqual([e.host_bond, e.guest_count], [bond, 3]);
};
/** Door check-in on the local site with the host's staff token (NEP-413 proof; the token stays in this process). */
steps["demo-checkin"] = async () => {
  const { signMessage } = await import("near-api-js/nep413");
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()));
  const signed = await signMessage({ signerAccount: account(DEMO_HOST), payload: { message: "Sign in to Nearvent", recipient: ESCROW, nonce } });
  const signature = typeof signed.signature === "string" ? signed.signature : Buffer.from(signed.signature).toString("base64");
  const session = await fetch(`${SITE}/api/checkin/session`, { method: "POST", body: JSON.stringify({ wallet: { accountId: DEMO_HOST, publicKey: signed.publicKey.toString(), signature, nonce: Buffer.from(nonce).toString("base64") } }) });
  const { token, error } = await session.json();
  if (!token) throw new Error(`staff token: ${error ?? session.status}`);
  for (const g of [STAN, HEBERT, G2]) {
    const r = await fetch(`${SITE}/api/checkin`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ event: state.demo, account: g, on: true }) });
    console.log(`check in ${g}`, r.status, r.ok ? "" : (await r.json()).error);
  }
  console.log("checked in", (await (await fetch(`${SITE}/api/checkin?e=${state.demo}`)).json()).checkedIn);
};
/** After the start a Deposit event takes no new guest (audit E-H1): alexandre's USDC comes back. */
steps["demo-late"] = async () => {
  const e = await event(state.demo);
  while (Date.now() < e.metadata.starts_at + 3_000) await sleep(3_000);
  const before = await usdcOf(HOST_B);
  await pay("register after the start (refused)", HOST_B, D, { action: "register", event_id: state.demo });
  assert.equal(await usdcOf(HOST_B), before, "a late registration was kept");
  assert.equal(await view(ESCROW, "get_guest_status", { event_id: state.demo, account_id: HOST_B }), null);
};
steps["demo-publish"] = async () => {
  const e = await event(state.demo);
  while (Date.now() < e.metadata.ends_at + 5_000) await sleep(5_000);
  await tx("publish: stan, g2 (hebert left off)", DEMO_HOST, ESCROW, "finalize", { event_id: state.demo, attended: [STAN, G2] }, { deposit: 1n, gas: 100_000_000_000_000n });
  const s = await event(state.demo);
  assert.equal(s.status, "Submitted");
  console.log("challenge ends", new Date(s.challenge_ends_at).toISOString(), "resolve by", new Date(s.resolve_by).toISOString());
};
steps["demo-dispute"] = async () => {
  await pay("hebert says he came", HEBERT, D, { action: "dispute", event_id: state.demo, target: HEBERT, attended: true });
  console.log("disputes", await view(ESCROW, "get_disputes", { event_id: state.demo }));
};
steps["demo-votes"] = async () => {
  assert.equal(await vote("hebert uphold", await proposalId(tag(state.demo, HEBERT, true)), "VoteApprove", COUNCIL.slice(0, 3)), "Approved");
  assert.equal(await vote("hebert dismiss", await proposalId(tag(state.demo, HEBERT, false)), "VoteReject", COUNCIL.slice(2, 5)), "Rejected");
  const e = await event(state.demo);
  assert.deepEqual([e.open_disputes, e.upheld_disputes, e.attended_count], [0, 1, 3]);
};
/** Escrow-wide: once nothing is open, the USDC held equals every balance owed. */
async function escrowBalancesAddUp() {
  const open = (await view(ESCROW, "get_events", { from_index: 0, limit: 100 })).filter((x) => ["Open", "Submitted"].includes(x.status) && (x.guest_count > 0 || x.host_bond !== "0"));
  assert.deepEqual(open.map((x) => x.id), [], "events still hold money");
  // A Set: the owner may also be one of the hosts.
  const everyone = [...new Set([STAN, HEBERT, G2, DEMO_HOST, OWNER, HOST_A, HOST_B])];
  const owed = (await Promise.all(everyone.map(escrowOf))).reduce((a, b) => a + b, 0n);
  const held = await usdcOf(ESCROW);
  console.log("escrow holds", (Number(held) / 1e6).toFixed(6), "USDC; balances owed", (Number(owed) / 1e6).toFixed(6));
  assert.equal(held, owed, "money in = money out");
}
steps["demo-check"] = async () => {
  const e = await event(state.demo);
  assert.deepEqual([e.status, e.attended_count, e.upheld_disputes, e.payout_per_attendee], ["Finalized", 3, 1, D.toString()]);
  if (state.demoOthers?.length) {
    console.log(`events ${state.demoOthers} were open at the start too: their payouts mix into the deltas, checking escrow-wide only`);
  } else {
    // Pool 3 over 3 attendees; hebert also gets his dispute bond back and the winner's half of the host bond.
    // The winner's half of the bond, at most 5 deposits (MAX_WIN_DEPOSITS); the rest to the treasury.
    const half = BigInt(e.host_bond) / 2n < 5n * D ? BigInt(e.host_bond) / 2n : 5n * D;
    const gain = { [STAN]: D, [HEBERT]: D + D + half, [G2]: D, [DEMO_HOST]: 0n, [OWNER]: BigInt(e.host_bond) - half };
    for (const [who, want] of Object.entries(gain)) {
      const got = (await escrowOf(who)) - BigInt(state.demoBefore[who]);
      console.log(`${who.padEnd(34)} +${(Number(got) / 1e6).toFixed(6)} USDC (expected +${(Number(want) / 1e6).toFixed(6)})`);
      assert.equal(got, want, who);
    }
  }
  await escrowBalancesAddUp();
};

const step = process.argv[2];
if (!steps[step]) throw new Error(`Step: ${Object.keys(steps).join(" | ")}`);
await steps[step]();
