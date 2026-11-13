import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Server modules run in a child Node with the scripts' TS loader; `fetch` is a fake Redis that
// records the commands and keeps plain keys in a Map.
const web = fileURLToPath(new URL("..", import.meta.url));
const run = (code) => {
  const env = { ...process.env, NEXT_PUBLIC_NETWORK: "testnet", NEXT_PUBLIC_EVENTS_CONTRACT: "escrow.test.testnet",
    UPSTASH_REDIS_REST_URL: "http://redis.test", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_REDIS_URL: "http://limits.test", RATE_LIMIT_REDIS_TOKEN: "t" };
  delete env.VERCEL;
  const script = `
    const sent = [], store = new Map();
    globalThis.fetch = async (_url, init) => {
      const [cmd, ...a] = JSON.parse(init.body);
      sent.push([cmd, ...a]);
      const result = cmd === "EVAL" ? 0 : cmd === "EXISTS" ? Number(store.has(a[0]))
        : cmd === "INCRBY" || cmd === "DECRBY" ? (store.set(a[0], (store.get(a[0]) ?? 0) + (cmd === "INCRBY" ? a[1] : -a[1])), store.get(a[0]))
        : cmd === "SET" ? (store.set(a[0], a[1]), "OK") : null;
      return new Response(JSON.stringify({ result }));
    };
    ${code}`;
  return JSON.parse(execFileSync(process.execPath, ["--no-warnings", "--conditions=react-server", "--import", path.join(web, "scripts/ts-register.mjs"), "--input-type=module", "-e", script], { cwd: web, env }).toString());
};

test("cover uploads count per IP and per account a day, and run free without the rate-limit Redis locally", () => {
  const r = run(`
    const { dailyLimited } = await import(${JSON.stringify(path.join(web, "src/lib/ratelimit.ts"))});
    const req = new Request("http://x/api/covers", { headers: { "x-forwarded-for": "1.2.3.4" } });
    const limited = await dailyLimited(req, "covers", "alice.testnet", 20);
    const [, , n, ...rest] = sent[0];
    delete process.env.RATE_LIMIT_REDIS_URL;
    console.log(JSON.stringify({ limited, keys: rest.slice(0, n), limits: rest.slice(n + 1), local: await dailyLimited(req, "covers", "alice.testnet", 20) }));
  `);
  assert.equal(r.limited, false);
  assert.deepEqual(r.keys, ["near-me:testnet:covers:day:ip:1.2.3.4", "near-me:testnet:covers:day:account:alice.testnet"]);
  assert.deepEqual(r.limits, [20, 86400, 20, 86400]);
  assert.equal(r.local, false, "local development without the rate-limit Redis behaves as before");
});

test("cover uploads stop at the byte budget; a repeat upload is free", () => {
  const r = run(`
    const c = await import(${JSON.stringify(path.join(web, "src/lib/covers.ts"))});
    const photo = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n, 1)]);
    const first = await c.saveCover(photo(10));
    const again = await c.saveCover(photo(10));
    store.set("covers:bytes", 100_000_000 - 4);
    const full = await c.saveCover(photo(20)).then(() => "saved", (e) => e.message);
    console.log(JSON.stringify({ same: first === again, full, used: store.get("covers:bytes"), sets: sent.filter((x) => x[0] === "SET").length }));
  `);
  assert.equal(r.same, true);
  assert.equal(r.full, "Cover storage is full");
  assert.equal(r.used, 100_000_000 - 4, "a refused upload gives its bytes back");
  assert.equal(r.sets, 1, "the repeat and the refused upload store nothing");
});
