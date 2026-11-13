import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { quoteSigned } from "../src/lib/quoteSignature.ts";

// A live 1Click quote (Base USDC → NEAR USDC into a dummy Intents account), as our proxy returns it.
const live = JSON.parse(readFileSync(new URL("./fixtures/oneclick-quote.json", import.meta.url), "utf8"));

test("a quote 1Click signed passes; any change to where or how much to pay fails", () => {
  assert.equal(quoteSigned(live), true);
  for (const [part, key, value] of [
    ["quote", "depositAddress", "0x000000000000000000000000000000000000dEaD"],
    ["quote", "amountIn", "1"],
    ["quoteRequest", "recipient", "0x1111111111111111111111111111111111111111"],
    ["quoteRequest", "destinationAsset", "nep141:wrap.near"],
  ]) {
    const changed = structuredClone(live);
    changed[part][key] = value;
    assert.equal(quoteSigned(changed), false, `${part}.${key}`);
  }
  assert.equal(quoteSigned({ ...live, signature: "ed25519:1111" }), false);
  assert.equal(quoteSigned({ ...live, timestamp: "2020-01-01T00:00:00.000Z" }), false);
});
