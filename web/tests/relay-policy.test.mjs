import assert from "node:assert/strict";
import test from "node:test";
import { actions, buildDelegateAction, createTransaction, encodeDelegateAction, encodeTransaction, KeyPair } from "near-api-js";
import { decodePayload, relayAllowed } from "../src/lib/relayPolicy.ts";

const contracts = { events: "escrow.nearvent.near", usdc: "usdc.near", intents: "intents.near" };
const key = KeyPair.fromRandom("ed25519").getPublicKey();
const sender = Buffer.from(key.data).toString("hex");
const call = (method, deposit = 1n) => actions.functionCall(method, { event_id: 1 }, 30_000_000_000_000n, deposit);
const delegate = (receiverId, list) =>
  encodeDelegateAction(buildDelegateAction({ senderId: sender, receiverId, actions: list, nonce: 7n, maxBlockHeight: 100n, publicKey: key }));
const tx = (receiverId, list) => encodeTransaction(createTransaction(sender, key, receiverId, 7n, list, new Uint8Array(32)));

test("decodePayload reads delegate actions and transactions alike", () => {
  for (const bytes of [delegate(contracts.events, [call("cancel")]), tx(contracts.events, [call("cancel")])]) {
    const p = decodePayload(bytes);
    assert.equal(p.signerId, sender);
    assert.equal(p.receiverId, contracts.events);
    assert.deepEqual(p.calls.map((c) => [c.methodName, c.deposit, c.gas]), [["cancel", 1n, 30_000_000_000_000n]]);
    assert.equal(JSON.parse(new TextDecoder().decode(p.calls[0].args)).event_id, 1);
    assert.equal(relayAllowed(p, contracts), true);
  }
  const d = decodePayload(delegate(contracts.events, [call("cancel")]));
  assert.equal(d.delegate.nonce, 7n);
  assert.equal(Buffer.from(d.delegate.publicKey).toString("hex"), sender);
  assert.equal(decodePayload(tx(contracts.events, [call("cancel")])).delegate, undefined);
});

test("relayAllowed pays only for our contracts and USDC leaving Intents", () => {
  const allowed = (receiver, method) => relayAllowed(decodePayload(delegate(receiver, [call(method)])), contracts);
  assert.equal(allowed(contracts.usdc, "ft_transfer_call"), true);
  assert.equal(allowed(contracts.intents, "ft_withdraw"), true);
  assert.equal(allowed(contracts.intents, "mt_transfer"), true);
  assert.equal(allowed(contracts.intents, "execute_intents"), false);
  assert.equal(allowed("wrap.near", "near_deposit"), false);
});

test("decodePayload refuses anything but function calls, and garbage", () => {
  assert.equal(decodePayload(delegate(contracts.events, [actions.transfer(1n)])), null);
  assert.equal(decodePayload(delegate(contracts.events, [call("cancel"), actions.deleteAccount("x.near")])), null);
  assert.equal(decodePayload(tx(contracts.events, [])), null);
  assert.equal(decodePayload(new Uint8Array([0x6e, 0x01, 0x00, 0x40, 1, 2, 3])), null);
  assert.equal(decodePayload(new Uint8Array(0)), null);
});
