// near.com keeps most guests' money on Confidential Intents (intents.far), which has no
// public RPC: 1Click reads and moves it once the guest's wallet signs. Pure helpers,
// shared by the browser and the tests.

/**
 * The versioned nonce 1Click's user sign-in requires (a random one is "invalid nonce"):
 * magic, version 0, the verifier's 4-byte salt, deadline and start time in ns, 7 random bytes.
 */
export function versionedNonce(saltHex: string, deadline: Date, now = new Date()): string {
  if (!/^[0-9a-f]{8}$/.test(saltHex)) throw new Error("Bad verifier salt");
  const bytes = new Uint8Array(32);
  bytes.set([86, 40, 246, 198, 0]);
  bytes.set(saltHex.match(/../g)!.map((h) => parseInt(h, 16)), 5);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(9, BigInt(deadline.getTime()) * 1_000_000n, true);
  view.setBigUint64(17, BigInt(now.getTime()) * 1_000_000n, true);
  crypto.getRandomValues(bytes.subarray(25));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Why the intent 1Click asks the guest to sign is not just "send at most `amountIn` USDC
 * to `depositAddress`", or null. We check before the wallet shows it.
 */
export function moveProblem(
  payload: string,
  o: { signer: string; depositAddress: string; amountIn: string; asset: string },
): string | null {
  try {
    const p = JSON.parse(payload);
    if (p.signer_id !== o.signer) return "another account";
    if (!Array.isArray(p.intents) || p.intents.length !== 1) return "more than one action";
    const [i] = p.intents;
    if (i.intent !== "transfer" || i.receiver_id !== o.depositAddress) return `a ${i.intent} to ${i.receiver_id}`;
    const tokens = Object.entries(i.tokens ?? {});
    if (tokens.length !== 1) return "more than one token";
    const [[token, amount]] = tokens;
    // Confidential balances name a token imt:<64-hex treasury>:<asset id>.
    const asset = /^imt:[0-9a-f]{64}:/.test(token) ? token.slice(69) : token;
    if (asset !== o.asset) return `token ${token}`;
    if (BigInt(amount as string) > BigInt(o.amountIn)) return `${amount} instead of ${o.amountIn}`;
    return null;
  } catch {
    return "unreadable";
  }
}

/** A token amount in USDC's 6 decimals (USDC on BNB Chain has 18, on Stellar 7). */
export function toUsdc6(raw: bigint, decimals: number): bigint {
  return decimals >= 6 ? raw / 10n ** BigInt(decimals - 6) : raw * 10n ** BigInt(6 - decimals);
}

/**
 * Which USDC to pay `shortfall` (6 decimals) from: NEAR's own USDC needs no swap; any other
 * kind (Base, Ethereum, Solana…) is swapped by 1Click, so it must cover ~0.6% more for fees.
 */
export function pickUsdc(kinds: { assetId: string; amount6: bigint }[], shortfall: bigint, nativeId: string): string | null {
  const native = kinds.find((k) => k.assetId === nativeId && k.amount6 >= shortfall);
  if (native) return native.assetId;
  const other = kinds.filter((k) => k.assetId !== nativeId && k.amount6 * 1000n >= shortfall * 1006n)
    .sort((a, b) => (b.amount6 > a.amount6 ? 1 : -1))[0];
  return other?.assetId ?? null;
}
