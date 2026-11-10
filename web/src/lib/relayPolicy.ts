// What our relayer pays gas for: signed calls to Nearvent's own contracts only.
// Shared by /api/fastauth/sign (NEAR Auth transactions and delegate actions) and
// /api/fastauth/relay (NEP-366 meta-transactions). Pure, so tests can import it.
import { decodeTransaction, SCHEMA } from "near-api-js";
import { deserialize } from "borsh";

/** Every encoded delegate action starts with the NEP-366 prefix 2^30 + 366 (u32, little-endian). */
const DELEGATE_PREFIX = [0x6e, 0x01, 0x00, 0x40];

export interface SignedCall {
  methodName: string;
  args: Uint8Array;
  gas: bigint;
  deposit: bigint;
}

export interface Payload {
  signerId: string;
  receiverId: string;
  calls: SignedCall[];
  /** Set when the payload is a delegate action (meta-transaction). */
  delegate?: { nonce: bigint; publicKey: Uint8Array; action: unknown };
}

export interface Contracts {
  events: string;
  usdc: string;
  intents: string | null;
}

interface RawAction {
  functionCall?: { methodName: string; args: Uint8Array | number[]; gas: bigint | number; deposit: bigint | number };
}

/** A transaction or a delegate action made only of function calls; anything else is null. */
export function decodePayload(bytes: Uint8Array): Payload | null {
  try {
    const isDelegate = DELEGATE_PREFIX.every((b, i) => bytes[i] === b);
    const raw = (isDelegate ? deserialize(SCHEMA.DelegateAction, bytes.subarray(4)) : decodeTransaction(bytes)) as unknown as {
      signerId?: string; senderId?: string; receiverId: string; actions: RawAction[];
      nonce: bigint | number; publicKey: { ed25519Key?: { data: number[] | Uint8Array } };
    };
    if (!raw.actions.length || !raw.actions.every((a) => a.functionCall)) return null;
    return {
      signerId: (isDelegate ? raw.senderId : raw.signerId)!,
      receiverId: raw.receiverId,
      calls: raw.actions.map(({ functionCall: f }) => ({
        methodName: f!.methodName, args: Uint8Array.from(f!.args), gas: BigInt(f!.gas), deposit: BigInt(f!.deposit),
      })),
      delegate: isDelegate
        ? { nonce: BigInt(raw.nonce), publicKey: Uint8Array.from(raw.publicKey.ed25519Key!.data), action: raw }
        : undefined,
    };
  } catch {
    return null;
  }
}

/** Our escrow and USDC, plus moving USDC out of NEAR Intents. */
export function relayAllowed(p: Payload, c: Contracts): boolean {
  if (p.receiverId === c.intents) return p.calls.every((x) => x.methodName === "ft_withdraw" || x.methodName === "mt_transfer");
  return p.receiverId === c.events || p.receiverId === c.usdc;
}
