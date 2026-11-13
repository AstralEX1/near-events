import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// lib/staff.ts runs in a child Node with the scripts' TS loader, as in abuse-limits.test.mjs.
const web = fileURLToPath(new URL("..", import.meta.url));

test("the sign-in token lasts one day; older 30-day and expired tokens are refused", () => {
  const env = { ...process.env, NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_EVENTS_CONTRACT: "escrow.test.testnet", APP_SECRET: "test-secret" };
  const script = `
    const { createHmac } = await import("node:crypto");
    const { issueStaffToken, readStaffToken } = await import(${JSON.stringify(path.join(web, "src/lib/staff.ts"))});
    const now = Math.floor(Date.now() / 1000);
    // A token as the server signs it, with any expiry.
    const forge = (exp) => {
      const body = Buffer.from("alice.testnet").toString("base64url") + "." + exp;
      return body + "." + createHmac("sha256", "test-secret").update("staff:" + body).digest("base64url");
    };
    const token = issueStaffToken("alice.testnet");
    console.log(JSON.stringify({
      ttl: Number(token.split(".")[1]) - now,
      fresh: readStaffToken(token),
      old30: readStaffToken(forge(now + 29 * 24 * 3600)),
      expired: readStaffToken(forge(now - 1)),
      tampered: readStaffToken(token.slice(0, -2) + "xx"),
    }));`;
  const r = JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--conditions=react-server", "--import", path.join(web, "scripts/ts-register.mjs"), "--input-type=module", "-e", script], { cwd: web, env }).toString());
  assert.ok(r.ttl >= 86399 && r.ttl <= 86400, `ttl ${r.ttl}`);
  assert.equal(r.fresh, "alice.testnet");
  assert.equal(r.old30, null, "tokens from the old 30-day rule stop working");
  assert.equal(r.expired, null);
  assert.equal(r.tampered, null);
});
