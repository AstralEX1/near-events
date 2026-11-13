// Owner actions on the escrow. The owner's key is read from
// ~/.near-credentials/<NETWORK>/<OWNER>.json or, without that file, typed at a hidden prompt
// (private key or seed phrase; never printed or saved). On mainnet it asks for a typed "yes" first.
// Env: OWNER, EVENTS_CONTRACT, optional NETWORK (testnet | mainnet, default testnet).
// Usage: node scripts/escrow-owner.mjs mode on|off            (whitelist: only listed hosts create events)
//        node scripts/escrow-owner.mjs add|remove <account> [<account> ...]
//        node scripts/escrow-owner.mjs sponsor-mode on|off    (sponsored: only listed hosts get free events)
//        node scripts/escrow-owner.mjs sponsor|unsponsor <account> [<account> ...]
//        node scripts/escrow-owner.mjs upgrade <path/to/near_events.wasm>
//        node scripts/escrow-owner.mjs freeze      (one-way: the code can never change again)
//        node scripts/escrow-owner.mjs rules '<json>'  (v3: court, treasury, bond per seat, hours; new events only)
import { readFileSync } from "node:fs";
import { Account, JsonRpcProvider } from "near-api-js";
import { accountKey, ask, closePrompts, fail } from "./keyPrompt.mjs";

const env = (k) => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
const [OWNER, EVENTS] = ["OWNER", "EVENTS_CONTRACT"].map(env);
const network = process.env.NETWORK ?? "testnet";
const provider = new JsonRpcProvider({ url: network === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://test.rpc.fastnear.com" });
const [command, ...rest] = process.argv.slice(2);
const USAGE = "Usage: mode on|off | add|remove <accounts> | sponsor-mode on|off | sponsor|unsponsor <accounts> | upgrade <wasm> | freeze | rules '<json>'";
if (!["mode", "add", "remove", "sponsor-mode", "sponsor", "unsponsor", "upgrade", "freeze", "rules"].includes(command)) fail(USAGE);
const owner = new Account(OWNER, provider, (await accountKey(provider, network, OWNER)).toString());
if (network === "mainnet" && (await ask(`${OWNER} on ${EVENTS}: ${[command, ...rest].join(" ")}. Type "yes" to send: `)) !== "yes") fail("Cancelled; nothing was sent.");
closePrompts();
const TGAS = 1_000_000_000_000n;

// 1 yoctoNEAR on every owner call: a limited (function-call) key cannot attach it.
const call = (methodName, args, gas = 30n * TGAS) =>
  owner.callFunctionRaw({ contractId: EVENTS, methodName, args, deposit: 1n, gas, waitUntil: "FINAL" });
let outcome;
if (command === "mode" && ["on", "off"].includes(rest[0])) outcome = await call("set_whitelist_mode", { enabled: rest[0] === "on" });
else if (command === "add" && rest.length) outcome = await call("add_to_whitelist", { accounts: rest });
else if (command === "remove" && rest.length) outcome = await call("remove_from_whitelist", { accounts: rest });
else if (command === "sponsor-mode" && ["on", "off"].includes(rest[0])) outcome = await call("set_sponsored_mode", { enabled: rest[0] === "on" });
else if (command === "sponsor" && rest.length) outcome = await call("add_sponsored", { accounts: rest });
else if (command === "unsponsor" && rest.length) outcome = await call("remove_sponsored", { accounts: rest });
// The new code is the raw call input, not JSON.
else if (command === "upgrade" && rest[0]) outcome = await call("upgrade", new Uint8Array(readFileSync(rest[0])), 300n * TGAS);
else if (command === "freeze") outcome = await call("freeze", {});
else if (command === "rules" && rest[0]) outcome = await call("set_rules", { rules: JSON.parse(rest[0]) });
else fail(USAGE);
if (outcome.status?.Failure) throw new Error(`Failed: ${JSON.stringify(outcome.status.Failure)}`);
console.log(command, "done:", outcome.transaction.hash);
console.log(await provider.callFunction({ contractId: EVENTS, method: "get_config", args: {} }));
