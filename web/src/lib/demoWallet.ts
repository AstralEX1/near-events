"use client";

// Demo account: a real testnet account whose key lives in this browser.
// No wallet app, no popup: every call is signed at once (auto-sign) and sent
// as a real transaction. Testnet only — the starter NEAR and USDC come from our relayer.
import { Account, JsonRpcProvider, KeyPair } from "near-api-js";
import { signMessage } from "near-api-js/nep413";
import { EVENTS_CONTRACT, RPC_URL } from "./config";
import { STAFF_MESSAGE } from "./staffShared";
import type { Call } from "./wallet";

const KEY = "near-events:demo-key";

function account(secret: string): Account {
  const pair = KeyPair.fromString(secret as `ed25519:${string}`);
  // An implicit account id is the hex of its public key.
  const id = Array.from(pair.getPublicKey().data, (b) => b.toString(16).padStart(2, "0")).join("");
  return new Account(id, new JsonRpcProvider({ url: RPC_URL }), secret as `ed25519:${string}`);
}

/** The demo account saved in this browser, if any. */
export function demoRestore(): string | null {
  try {
    const secret = localStorage.getItem(KEY);
    return secret ? account(secret).accountId : null;
  } catch {
    return null;
  }
}

async function post(url: string, accountId: string) {
  const res = await fetch(url, { method: "POST", body: JSON.stringify({ accountId, demo: true }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not set up the demo account");
}

/** Creates (or reuses) the browser's demo account and tops it up with gas money and test USDC. */
export async function demoLogin(): Promise<string> {
  let secret: string | null = null;
  try {
    secret = localStorage.getItem(KEY);
  } catch {}
  if (!secret) {
    secret = KeyPair.fromRandom("ed25519").toString();
    try {
      localStorage.setItem(KEY, secret);
    } catch {}
  }
  const id = account(secret).accountId;
  await post("/api/fastauth/fund", id);
  await post("/api/faucet", id);
  return id;
}

export function demoLogout() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

function current(): Account {
  const secret = localStorage.getItem(KEY);
  if (!secret) throw new Error("The demo account is gone from this browser. Sign in again.");
  return account(secret);
}

export async function demoSend(call: Call): Promise<void> {
  await current().callFunction({
    contractId: call.receiverId,
    methodName: call.methodName,
    args: call.args as Record<string, unknown>,
    gas: call.gas ?? 100_000_000_000_000n,
    deposit: call.deposit ?? 0n,
  });
}

/** Same NEP-413 proof a NEAR wallet gives at sign-in, signed with the browser key. */
export async function demoProof() {
  const signer = current();
  const nonce = new Uint8Array(32);
  crypto.getRandomValues(nonce);
  new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()));
  const signed = await signMessage({ signerAccount: signer, payload: { message: STAFF_MESSAGE, recipient: EVENTS_CONTRACT, nonce } });
  return {
    wallet: {
      accountId: signed.accountId,
      publicKey: signed.publicKey.toString(),
      signature: btoa(String.fromCharCode(...signed.signature)),
      nonce: btoa(String.fromCharCode(...nonce)),
    },
  };
}
