import assert from "node:assert/strict";
import test from "node:test";
import { evmDepositTx } from "../src/lib/oneclickClient.ts";

const from = "0x1c00457e4d35ec62a5c990d20a6380855cb2cdb5";
const deposit = "0xAbC0000000000000000000000000000000000001";

test("native coin goes straight to the deposit address", () => {
  assert.deepEqual(evmDepositTx(from, {}, deposit, "1000000000000000"), { from, to: deposit, value: "0x38d7ea4c68000" });
});

test("ERC-20 calls transfer(deposit, amount) on the token", () => {
  const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  assert.deepEqual(evmDepositTx(from, { contractAddress: usdc }, deposit, "1010309"), {
    from,
    to: usdc,
    data: "0xa9059cbb"
      + "000000000000000000000000abc0000000000000000000000000000000000001"
      + "00000000000000000000000000000000000000000000000000000000000f6a85",
  });
});

test("refuses anything that is not a plain EVM address and positive amount", () => {
  assert.throws(() => evmDepositTx(from, {}, "intents.near", "1"));
  assert.throws(() => evmDepositTx(from, { contractAddress: "usdc.near" }, deposit, "1"));
  assert.throws(() => evmDepositTx(from, {}, deposit, "0"));
  assert.throws(() => evmDepositTx(from, {}, deposit, "1.5"));
});
