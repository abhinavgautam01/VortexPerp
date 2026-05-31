import { describe, it, expect } from "vitest";
import {
  markPrice,
  notionalUsdFromLamports,
  tradingFeeLamports,
  openLong,
  openShort,
  closePosition,
  liquidationPrice,
  formatScaled,
  type VammMathState,
} from "./math.js";
import { SCALE, LAMPORTS_PER_SOL } from "./constants.js";

describe("Math SDK", () => {
  it("calculates markPrice correctly", () => {
    const vamm: VammMathState = {
      baseAssetReserve: 100n * SCALE,
      quoteAssetReserve: 2000n * SCALE,
      k: 200_000n * SCALE * SCALE,
    };
    // markPrice = quoteReserve * SCALE / baseReserve
    // (2000 * 1e6) / (100 * 1e6) * SCALE = 20 * SCALE
    const price = markPrice(vamm);
    expect(price).toBe(20n * SCALE);
  });

  it("calculates notional USD from lamports correctly", () => {
    // 1 SOL margin, 5x leverage, index price $100
    const margin = 1n * LAMPORTS_PER_SOL;
    const leverage = 5n;
    const indexPrice = 100n * SCALE;
    const notional = notionalUsdFromLamports(margin, leverage, indexPrice);
    
    // Notional should be 500 * SCALE
    expect(notional).toBe(500n * SCALE);
  });

  it("calculates trading fees correctly", () => {
    // 1 SOL margin, 5x leverage
    const margin = 1n * LAMPORTS_PER_SOL;
    const leverage = 5n;
    const fee = tradingFeeLamports(margin, leverage);
    // 1e9 * 5 * 10 / 10000 = 5_000_000 lamports
    expect(fee).toBe(5_000_000n);
  });

  it("opens a long position correctly", () => {
    const vamm: VammMathState = {
      baseAssetReserve: 100n * SCALE,
      quoteAssetReserve: 100n * SCALE,
      k: 10_000n * SCALE * SCALE,
    };
    
    // add 10 quote, so quote = 110. newBase = 10000 / 110 = 90.9090...
    // size = 100 - 90.9090... = 9.0909...
    const quoteAmount = 10n * SCALE;
    const margin = 1n * LAMPORTS_PER_SOL;
    const indexPrice = 1n * SCALE;

    const result = openLong(vamm, quoteAmount, margin, indexPrice);
    
    expect(result.quoteAssetReserve).toBe(110n * SCALE);
    expect(result.baseAssetReserve).toBeLessThan(100n * SCALE);
    expect(result.size).toBeGreaterThan(0n);
    expect(result.entryPrice).toBeGreaterThan(1n * SCALE); // entry price > initial price due to slippage
  });

  it("opens a short position correctly", () => {
    const vamm: VammMathState = {
      baseAssetReserve: 100n * SCALE,
      quoteAssetReserve: 100n * SCALE,
      k: 10_000n * SCALE * SCALE,
    };
    
    // remove 10 quote, so quote = 90. newBase = 10000 / 90 = 111.1111...
    // size = 111.1111 - 100 = 11.1111...
    const quoteAmount = 10n * SCALE;
    const margin = 1n * LAMPORTS_PER_SOL;
    const indexPrice = 1n * SCALE;

    const result = openShort(vamm, quoteAmount, margin, indexPrice);
    
    expect(result.quoteAssetReserve).toBe(90n * SCALE);
    expect(result.baseAssetReserve).toBeGreaterThan(100n * SCALE);
    expect(result.size).toBeGreaterThan(0n);
    expect(result.entryPrice).toBeLessThan(1n * SCALE); // entry price < initial price due to slippage
  });

  it("throws error when shorting more than quote reserve", () => {
    const vamm: VammMathState = {
      baseAssetReserve: 10n * SCALE,
      quoteAssetReserve: 10n * SCALE,
      k: 100n * SCALE * SCALE,
    };
    const quoteAmount = 15n * SCALE;
    const margin = 1n * LAMPORTS_PER_SOL;
    const indexPrice = 1n * SCALE;

    expect(() => openShort(vamm, quoteAmount, margin, indexPrice)).toThrowError("short exhausts quote reserve");
  });

  it("formats scaled numbers correctly", () => {
    expect(formatScaled(1_500_000n, 2)).toBe("1.50");
    expect(formatScaled(1_000_000n, 0)).toBe("1");
    expect(formatScaled(-500_000n, 2)).toBe("-0.50");
    expect(formatScaled(123_456n, 3)).toBe("0.123");
  });
});
