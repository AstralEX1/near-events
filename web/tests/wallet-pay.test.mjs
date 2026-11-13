import assert from "node:assert/strict";
import test from "node:test";
import { enough, pickWalletToken, rank } from "../src/lib/walletPayShared.ts";

const tok = (symbol, blockchain, decimals = 6, price = 1, contractAddress = "0xabc") => ({ assetId: `${symbol}-${blockchain}`, symbol, blockchain, decimals, price, contractAddress });
const usdcBase = tok("USDC", "base"), usdtArb = tok("USDT", "arb"), usdcEth = tok("USDC", "eth"), eth = tok("ETH", "base", 18, 2000, undefined), bscUsdc = tok("USDC", "bsc", 18);

test("rank: USDC on the current network, stablecoins, then native coins", () => {
  assert.equal(rank({ token: usdcBase, current: true }), 0);
  assert.equal(rank({ token: usdtArb, current: true }), 1);
  assert.equal(rank({ token: usdcEth, current: false }), 2);
  assert.equal(rank({ token: eth, current: true }), 3);
});

test("enough: +2% on stablecoins (any decimals), +5% and $1 on native coins", () => {
  assert.equal(enough(usdcBase, 1_000_000n), 1_020_000n);
  assert.equal(enough(bscUsdc, 1_000_000n), 1_020_000_000_000_000_000n);
  // (1.05 + 1) USD at $2000 per ETH = 0.001025 ETH
  assert.equal(enough(eth, 1_000_000n), 1_025_000_000_000_000n);
  assert.equal(enough({ ...eth, price: undefined }, 1_000_000n), null);
});

test("pickWalletToken takes the first in order that covers it", async () => {
  const c = (token, current, bal) => ({ token, current, balance: async () => bal });
  assert.equal(await pickWalletToken([c(eth, true, 10n ** 18n), c(usdcEth, false, 5_000_000n), c(usdcBase, true, 100n)], 1_000_000n), usdcEth);
  assert.equal(await pickWalletToken([c(usdcBase, true, 2_000_000n), c(usdcEth, false, 5_000_000n)], 1_000_000n), usdcBase);
  assert.equal(await pickWalletToken([c(eth, true, 10n ** 18n)], 1_000_000n), eth);
  const failing = { token: usdcBase, current: true, balance: async () => { throw new Error("rpc down"); } };
  assert.equal(await pickWalletToken([failing], 1_000_000n), null);
});
