// Read-only release check: sends no transactions and needs no keys.
// Env: NETWORK (testnet | mainnet, default testnet), EVENTS_CONTRACT (skip the escrow
// checks if unset, e.g. before the mainnet deploy), optional RELAYER_ACCOUNT, OWNER,
// WASM (compare the deployed code hash), USDC_CONTRACT, INTENTS_CONTRACT.
// Usage: NETWORK=mainnet EVENTS_CONTRACT=… RELAYER_ACCOUNT=… OWNER=… node scripts/check-release.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { baseEncode } from "near-api-js";

const network = process.env.NETWORK ?? "testnet";
const mainnet = network === "mainnet";
const RPC = mainnet ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com";
const ESCROW = process.env.EVENTS_CONTRACT;
const USDC = process.env.USDC_CONTRACT ?? (mainnet ? "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" : "usdc.tidepool-sandbox.testnet");
const INTENTS = process.env.INTENTS_CONTRACT ?? (mainnet ? "intents.near" : "verifier.tidepool-sandbox.testnet");
const RELAYER = process.env.RELAYER_ACCOUNT;
const OWNER = process.env.OWNER;
const FASTAUTH = mainnet ? "fast-auth.near" : "fast-auth.testnet";
const MPC = mainnet ? "v1.signer" : "v1.signer-prod.testnet";
const ONECLICK = mainnet ? "https://1click.chaindefuser.com" : "https://www.usetidepool.tech";
const NEAR = 10n ** 24n;

let failed = 0;
const ok = (name, detail = "") => console.log(`✓ ${name}${detail ? `: ${detail}` : ""}`);
const bad = (name, detail = "") => { failed++; console.log(`✗ ${name}${detail ? `: ${detail}` : ""}`); };
const check = async (name, fn) => {
  try {
    const r = await fn();
    if (r === false) bad(name); else ok(name, typeof r === "string" ? r : "");
  } catch (e) {
    bad(name, e instanceof Error ? e.message : String(e));
  }
};

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000),
  }).then((x) => x.json());
  if (r.error || r.result?.error) throw new Error(r.error?.cause?.name ?? r.error?.message ?? r.result.error);
  return r.result;
}
const account = (id) => rpc("query", { request_type: "view_account", finality: "final", account_id: id });
const view = async (id, method, args = {}) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: id, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString() || "null");
};
const near = (yocto) => `${(Number(BigInt(yocto) * 1000n / NEAR) / 1000).toFixed(3)} NEAR`;

console.log(`Nearvent release check on ${network}\n`);

const status = await rpc("status", []).catch(() => null);
if (status) ok("RPC", `${RPC}, protocol ${status.protocol_version}`); else bad("RPC", RPC);

if (ESCROW) {
  await check(`escrow ${ESCROW} code`, async () => {
    const a = await account(ESCROW);
    if (a.code_hash === "11111111111111111111111111111111") throw new Error("no contract deployed");
    if (process.env.WASM) {
      const expected = baseEncode(createHash("sha256").update(readFileSync(process.env.WASM)).digest());
      if (expected !== a.code_hash) throw new Error(`code hash ${a.code_hash}, WASM ${expected}`);
    }
    return `${a.code_hash}, ${near(a.amount)} (storage ${a.storage_usage} B)`;
  });
  await check("escrow has no access keys", async () => {
    const { keys } = await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: ESCROW });
    if (keys.length) throw new Error(`${keys.length} key(s) left: anyone holding one can replace the code`);
  });
  await check("escrow config", async () => {
    const c = await view(ESCROW, "get_config");
    const wrong = [["usdc", USDC], ["intents", INTENTS], ...(RELAYER ? [["relayer", RELAYER]] : []), ...(OWNER ? [["owner", OWNER]] : [])]
      .filter(([k, v]) => c[k] !== v).map(([k, v]) => `${k} is ${c[k]}, expected ${v}`);
    if (wrong.length) throw new Error(wrong.join("; "));
    return `owner ${c.owner}, relayer ${c.relayer}, frozen ${c.frozen}, whitelist ${c.whitelist_mode ? "on" : "off"}`;
  });
  // Escrow v3: a release build, and with a court a DAO the factory cannot rewrite.
  await check("escrow v3 rules", async () => {
    const c = await view(ESCROW, "get_config");
    if (!c.rules) return "v2 escrow (no disputes)";
    if (mainnet && c.oracle_hour_ms !== 3_600_000) throw new Error(`oracle hour ${c.oracle_hour_ms} ms: a testnet rehearsal build`);
    const r = c.rules;
    const hours = `window ${r.challenge_hours} h, publish ${r.submit_hours} h, court ${r.resolve_hours} h`;
    if (!r.dao) return `no court yet: host lists are final at publish, no bond; ${hours}`;
    const info = await view(r.dao, "get_factory_info");
    if (info.auto_update) throw new Error(`${r.dao} still lets ${info.factory_id} replace its code (FactoryInfoUpdate auto_update=false)`);
    const policy = await view(r.dao, "get_policy");
    const council = policy.roles.find((x) => x.name === "council")?.kind?.Group ?? [];
    if (mainnet && council.length !== 5) throw new Error(`council has ${council.length} members, expected 5`);
    return `court ${r.dao}, council ${council.length}, treasury ${r.treasury}, bond ${r.bond_per_seat} deposit(s) per seat, ${hours}`;
  });
  await check("escrow holds USDC storage", async () => !!(await view(USDC, "storage_balance_of", { account_id: ESCROW })));
  await check("escrow responds", async () => `${(await view(ESCROW, "get_recent_events", { limit: 100 })).length} recent events`);
} else {
  console.log("– escrow checks skipped (EVENTS_CONTRACT is not set)");
}

await check(`USDC ${USDC}`, async () => {
  const m = await view(USDC, "ft_metadata");
  if (m.decimals !== 6) throw new Error(`decimals ${m.decimals}`);
  return `${m.symbol}, 6 decimals`;
});
await check(`NEAR Intents ${INTENTS}`, async () => `salt ${await view(INTENTS, "current_salt")}`);
if (RELAYER) {
  await check(`relayer ${RELAYER}`, async () => {
    const a = await account(RELAYER);
    const balance = BigInt(a.amount);
    // Each relayed call costs about 0.001-0.003 NEAR on mainnet; new Google accounts 0.003 NEAR once.
    if (balance < 5n * NEAR) throw new Error(`only ${near(a.amount)}; keep at least 5 NEAR`);
    return near(a.amount);
  });
}
if (OWNER) await check(`owner ${OWNER}`, async () => near((await account(OWNER)).amount));
await check(`NEAR Auth ${FASTAUTH}`, async () => (await account(FASTAUTH)).code_hash !== "11111111111111111111111111111111");
await check(`MPC signer ${MPC}`, async () => (await account(MPC)).code_hash !== "11111111111111111111111111111111");
await check(`NEAR Auth JWT keys ${mainnet ? "login.auth.near.org" : "login.testnet.fast-auth.com"}`, async () => {
  const r = await fetch(`https://${mainnet ? "login.auth.near.org" : "login.testnet.fast-auth.com"}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
  const { keys } = await r.json();
  return `${keys.length} key(s)`;
});
await check(`1Click ${ONECLICK} lists USDC`, async () => {
  const tokens = await fetch(`${ONECLICK}/v0/tokens`, { signal: AbortSignal.timeout(12_000) }).then((r) => r.json());
  if (!tokens.some((t) => t.assetId === `nep141:${USDC}`)) throw new Error(`nep141:${USDC} is not in the token list`);
  return `${tokens.length} tokens`;
});
if (mainnet) {
  // A dry quote creates no deposit address and moves no money.
  await check("1Click dry quote ETH on Base → USDC in Intents", async () => {
    const q = await fetch(`${ONECLICK}/v0/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: "nep141:base.omft.near",
        depositType: "ORIGIN_CHAIN", destinationAsset: `nep141:${USDC}`, amount: "1000000",
        refundTo: "0x1111111111111111111111111111111111111111", refundType: "ORIGIN_CHAIN",
        recipient: "0x2222222222222222222222222222222222222222", recipientType: "INTENTS",
        referral: "near-events", deadline: new Date(Date.now() + 3600_000).toISOString(),
      }),
    }).then((r) => r.json());
    if (!q.quote) throw new Error(q.message ?? "no quote");
    return `1 USDC ≈ ${q.quote.amountInFormatted} ETH, ~${q.quote.timeEstimate}s`;
  });
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
