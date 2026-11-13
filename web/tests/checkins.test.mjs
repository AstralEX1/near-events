import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// checkins.ts is a server module: run it in a child Node with the scripts' TS loader,
// on the local file store in a temporary folder.
const web = fileURLToPath(new URL("..", import.meta.url));
const run = (code) => {
  const dir = mkdtempSync(path.join(tmpdir(), "checkins-"));
  try {
    const env = { ...process.env, NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_EVENTS_CONTRACT: "escrow.test.testnet" };
    for (const k of ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "VERCEL"]) delete env[k];
    const script = `const c = await import(${JSON.stringify(path.join(web, "src/lib/checkins.ts"))});\n${code}`;
    return JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--conditions=react-server", "--import", path.join(web, "scripts/ts-register.mjs"), "--input-type=module", "-e", script], { cwd: dir, env }).toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("unchecking appends to the door log instead of deleting", () => {
  const { log, list } = run(`
    await c.setCheckIn(1, "a.testnet", true, "host.testnet");
    await c.setCheckIn(1, "a.testnet", true, "door.testnet"); // repeat: nothing new
    await c.setCheckIn(1, "a.testnet", false, "host.testnet");
    await c.setCheckIn(1, "b.testnet", true, "door.testnet");
    console.log(JSON.stringify({ log: await c.checkInLog(1), list: await c.listCheckIns(1) }));
  `);
  assert.deepEqual(log.map((x) => [x.account, x.on, x.by]), [
    ["a.testnet", true, "host.testnet"],
    ["a.testnet", false, "host.testnet"],
    ["b.testnet", true, "door.testnet"],
  ]);
  assert.deepEqual(Object.keys(list), ["b.testnet"]);
  assert.equal(list["b.testnet"].by, "door.testnet");
});

test("a guest checked in again keeps the latest check-in", () => {
  const { list } = run(`
    await c.setCheckIn(2, "a.testnet", true, "host.testnet");
    await c.setCheckIn(2, "a.testnet", false, "host.testnet");
    await c.setCheckIn(2, "a.testnet", true, "door.testnet");
    console.log(JSON.stringify({ list: await c.listCheckIns(2) }));
  `);
  assert.equal(list["a.testnet"].by, "door.testnet");
});
