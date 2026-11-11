import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

/** The 0x address that signed `message` with `personal_sign` (ERC-191). `signature`: 65 bytes r‖s‖v, v in {0, 1}. */
export function erc191Signer(message: string, signature: Uint8Array): string {
  if (signature.length !== 65 || signature[64] > 1) throw new Error("Bad signature");
  const bytes = Buffer.from(message, "utf8");
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes]));
  const key = secp256k1.Signature.fromBytes(signature.subarray(0, 64), "compact")
    .addRecoveryBit(signature[64]).recoverPublicKey(digest).toBytes(false);
  return `0x${Buffer.from(keccak_256(key.subarray(1)).subarray(12)).toString("hex")}`;
}
