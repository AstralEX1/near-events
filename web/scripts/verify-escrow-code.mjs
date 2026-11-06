// Read-only. Usage: node scripts/verify-escrow-code.mjs <wasm> <account> <rpc-url>
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { baseEncode } from "near-api-js";

const [wasm, account_id, rpc] = process.argv.slice(2);
if (!wasm || !account_id || !rpc) throw new Error("Provide the WASM path, contract account and RPC URL");
const response = await fetch(rpc, {
  method: "POST",
  headers: { "content-type": "application/json" },
  signal: AbortSignal.timeout(12_000),
  body: JSON.stringify({
    jsonrpc: "2.0", id: "escrow-code", method: "query",
    params: { request_type: "view_account", finality: "final", account_id },
  }),
});
const result = await response.json();
const actual = result.result?.code_hash;
if (!response.ok || typeof actual !== "string") throw new Error("Could not read the deployed code hash");
const expected = baseEncode(createHash("sha256").update(readFileSync(wasm)).digest());
console.log({ account_id, expected, actual });
if (expected !== actual) process.exitCode = 1;
