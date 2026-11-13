import assert from "node:assert/strict";
import test from "node:test";
import { moveProblem, versionedNonce } from "../src/lib/nearcomShared.ts";

test("versionedNonce lays out magic, version, salt, deadline and start time like the Intents SDK", () => {
  const deadline = new Date("2026-11-13T08:00:00.000Z");
  const now = new Date("2026-11-13T07:55:00.000Z");
  const bytes = Buffer.from(versionedNonce("252812b3", deadline, now), "base64");
  assert.equal(bytes.length, 32);
  assert.deepEqual([...bytes.subarray(0, 9)], [86, 40, 246, 198, 0, 0x25, 0x28, 0x12, 0xb3]);
  assert.equal(bytes.readBigUInt64LE(9), BigInt(deadline.getTime()) * 1_000_000n);
  assert.equal(bytes.readBigUInt64LE(17), BigInt(now.getTime()) * 1_000_000n);
  assert.throws(() => versionedNonce("xyz", deadline));
});

const ok = { signer: "0xabc", depositAddress: "dep1", amountIn: "1000100", usdc: "usdc.near" };
const payload = (intents, signer = "0xabc") => JSON.stringify({ signer_id: signer, intents });
const transfer = (tokens, receiver_id = "dep1") => ({ intent: "transfer", receiver_id, tokens });

test("moveProblem accepts only a USDC transfer of at most amountIn to the deposit address", () => {
  assert.equal(moveProblem(payload([transfer({ "imt:51e8:nep141:usdc.near": "1000100" })]), ok), null);
  assert.equal(moveProblem(payload([transfer({ "nep141:usdc.near": "999" })]), ok), null);
  assert.match(moveProblem(payload([transfer({ "nep141:usdc.near": "1000101" })]), ok), /instead of/);
  assert.match(moveProblem(payload([transfer({ "nep141:usdc.near": "1" })], "evil.near"), ok), /another/);
  assert.match(moveProblem(payload([transfer({ "nep141:usdc.near": "1" })], "0xabc"), { ...ok, depositAddress: "dep2" }), /transfer to dep1/);
  assert.match(moveProblem(payload([transfer({ "nep141:wrap.near": "1" })]), ok), /token/);
  assert.match(moveProblem(payload([transfer({ "nep141:usdc.near": "1", "nep141:wrap.near": "1" })]), ok), /more than one token/);
  assert.match(moveProblem(payload([transfer({ "nep141:usdc.near": "1" }), transfer({ "nep141:usdc.near": "1" })]), ok), /more than one action/);
  assert.match(moveProblem(payload([{ intent: "token_diff", diff: {} }]), ok), /token_diff/);
  assert.equal(moveProblem("not json", ok), "unreadable");
});
