import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { erc191Signer } from "../src/lib/erc191.ts";

// What an EVM wallet's personal_sign produces, with v as 0/1 like the verifier wants.
function personalSign(secretKey, message) {
  const bytes = Buffer.from(message);
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
  const recovered = secp256k1.sign(digest, secretKey, { prehash: false, format: "recovered" });
  return Buffer.concat([recovered.subarray(1), recovered.subarray(0, 1)]);
}

test("erc191Signer recovers the signing address and nothing else", () => {
  const { secretKey } = secp256k1.keygen();
  const address = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(secretKey, false).subarray(1)).subarray(12)).toString("hex")}`;
  const sig = personalSign(secretKey, "Authorize event controls on Nearvent\nTime: 1");
  assert.equal(erc191Signer("Authorize event controls on Nearvent\nTime: 1", sig), address);
  assert.notEqual(erc191Signer("Authorize event controls on Nearvent\nTime: 2", sig), address);
  const v27 = Buffer.from(sig);
  v27[64] += 27;
  assert.throws(() => erc191Signer("x", v27));
  assert.throws(() => erc191Signer("x", sig.subarray(0, 64)));
});
