// Runs the keeper once from this machine: the same code as /api/keeper/tick.
//   node --conditions=react-server --import ./scripts/ts-register.mjs scripts/keeper-once.mjs [--dry]
// Env: NEXT_PUBLIC_NETWORK, NEXT_PUBLIC_EVENTS_CONTRACT, RELAYER_ACCOUNT_ID, and
// RELAYER_PRIVATE_KEY or that account's file in ~/.near-credentials (never printed).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const network = process.env.NEXT_PUBLIC_NETWORK ?? "testnet";
const relayer = process.env.RELAYER_ACCOUNT_ID;
if (!relayer || !process.env.NEXT_PUBLIC_EVENTS_CONTRACT) throw new Error("Set RELAYER_ACCOUNT_ID and NEXT_PUBLIC_EVENTS_CONTRACT");
const file = `${homedir()}/.near-credentials/${network}/${relayer}.json`;
if (!process.env.RELAYER_PRIVATE_KEY && existsSync(file)) process.env.RELAYER_PRIVATE_KEY = JSON.parse(readFileSync(file, "utf8")).private_key;

const { pendingEvents, planKeeper, runKeeper } = await import("../src/lib/keeper.ts");
const plan = await planKeeper(await pendingEvents());
console.log(JSON.stringify({ at: new Date().toISOString(), planned: plan.actions.map(({ description: _, ...a }) => a), lowDaos: plan.lowDaos }));
if (!process.argv.includes("--dry")) console.log(JSON.stringify(await runKeeper(plan), null, 1));
