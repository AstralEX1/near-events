// Who may mark guests at the door: the event's host (read from the contract)
// or a member of its door team (kept on this server, lib/cohosts.ts). A
// browser proves its NEAR account once, then
// holds a short-lived token signed by this server.
//
// Proofs:
// - NEAR wallet: a NEP-413 signed message, made with a full-access key of the account.
// - Google/email (NEAR Auth): a transaction signed by the account's MPC key and
//   never sent. These accounts are implicit, so the id is the public key.
// - EVM wallet (NEAR Intents account, the 0x address): an ERC-191 `personal_sign`.
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { JsonRpcProvider, baseDecode, decodeTransaction } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { EVENTS_CONTRACT, RPC_URL } from "./config";
import { events } from "./near";
import { getCohosts } from "./cohosts";
import { STAFF_MESSAGE, STAFF_PROOF_METHOD, evmStaffMessage } from "./staffShared";
import { erc191Signer } from "./erc191";

// Stay signed in like Luma/Unlock sessions instead of re-signing every 12 h. Signing out drops it locally.
const TOKEN_TTL_S = 30 * 24 * 60 * 60;
const PROOF_MAX_AGE_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.APP_SECRET ?? process.env.RELAYER_PRIVATE_KEY;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
}
const sign = (body: string) => createHmac("sha256", secret()).update(`staff:${body}`).digest("base64url");

export function issueStaffToken(accountId: string): string {
  const body = `${Buffer.from(accountId).toString("base64url")}.${Math.floor(Date.now() / 1000) + TOKEN_TTL_S}`;
  return `${body}.${sign(body)}`;
}

export function readStaffToken(token: string | null | undefined): string | null {
  const [acc, exp, sig] = (token ?? "").split(".");
  if (!acc || !exp || !sig) return null;
  const want = sign(`${acc}.${exp}`);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Buffer.from(acc, "base64url").toString();
}

/** Is `accountId` the host or on the door team of this event? Returns the event when yes. */
export async function staffEvent(eventId: number, accountId: string) {
  const e = await events.get(eventId);
  if (!e) return null;
  if (e.host !== accountId && !(await getCohosts(eventId)).includes(accountId)) return null;
  return e;
}

// ---------------------------------------------------------------- proofs

export interface WalletProof {
  accountId: string;
  publicKey: string;
  signature: string;
  /** base64 of the 32-byte nonce: 8 bytes of ms timestamp (big-endian) + random. */
  nonce: string;
}

/** NEP-413 signed message over STAFF_MESSAGE, by a full-access key of the account. */
export async function verifyWalletProof(p: WalletProof): Promise<string> {
  const nonce = new Uint8Array(Buffer.from(p.nonce, "base64"));
  if (nonce.length !== 32) throw new Error("Bad nonce");
  const at = Number(Buffer.from(nonce).readBigUInt64BE(0));
  if (Math.abs(Date.now() - at) > PROOF_MAX_AGE_MS) throw new Error("Sign-in expired, try again");
  const signature = p.signature.startsWith("ed25519:")
    ? baseDecode(p.signature.slice(8))
    : new Uint8Array(Buffer.from(p.signature, "base64"));
  await verifyMessage({
    signerAccountId: p.accountId,
    signerPublicKey: p.publicKey,
    payload: { message: STAFF_MESSAGE, recipient: EVENTS_CONTRACT, nonce },
    signature,
    provider: new JsonRpcProvider({ url: RPC_URL }),
  });
  return p.accountId;
}

export interface MpcProof {
  /** base64 of the borsh-encoded, unsent transaction. */
  transaction: string;
  /** base64 of the 64-byte ed25519 signature. */
  signature: string;
}

export async function verifyMpcProof(p: MpcProof): Promise<string> {
  const raw = new Uint8Array(Buffer.from(p.transaction, "base64"));
  const tx = decodeTransaction(raw);
  const call = tx.actions[0]?.functionCall;
  if (tx.receiverId !== EVENTS_CONTRACT || call?.methodName !== STAFF_PROOF_METHOD) throw new Error("Not a sign-in proof");
  const { at } = JSON.parse(Buffer.from(call.args).toString()) as { at: number };
  if (Math.abs(Date.now() - at) > PROOF_MAX_AGE_MS) throw new Error("Sign-in expired, try again");
  const key = tx.publicKey;
  // Implicit account: the id is the hex of the public key, so the key proves the account.
  if (Buffer.from(key.data).toString("hex") !== tx.signerId) throw new Error("Only Google/email accounts use this proof");
  const hash = createHash("sha256").update(raw).digest();
  if (!key.verify(hash, new Uint8Array(Buffer.from(p.signature, "base64")))) throw new Error("Bad signature");
  return tx.signerId;
}

export interface EvmProof {
  address: string;
  /** ms timestamp inside the signed message. */
  at: number;
  /** 0x hex from `personal_sign`. */
  signature: string;
}

export function verifyEvmProof(p: EvmProof): string {
  if (!/^0x[0-9a-f]{40}$/.test(p.address) || !Number.isSafeInteger(p.at) || !/^0x[0-9a-f]{130}$/i.test(p.signature)) throw new Error("Bad proof");
  if (Math.abs(Date.now() - p.at) > PROOF_MAX_AGE_MS) throw new Error("Sign-in expired, try again");
  const signature = Buffer.from(p.signature.slice(2), "hex");
  if (signature[64] >= 27) signature[64] -= 27;
  if (erc191Signer(evmStaffMessage(p.address, p.at), signature) !== p.address) throw new Error("Bad signature");
  return p.address;
}
