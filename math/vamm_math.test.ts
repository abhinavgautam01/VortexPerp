import { describe, expect, it } from "vitest";

import {
  LAMPORTS_PER_SOL,
  MAINTENANCE_MARGIN,
  SCALE,
} from "../sdk/src/constants.js";
import {
  closePosition,
  marginRatio,
  markPrice,
  notionalUsdFromLamports,
  openLong,
  openShort,
  tradingFeeLamports,
} from "../sdk/src/math.js";

const baseAssetReserve = 1_000_000n * SCALE;
const quoteAssetReserve = 20_000_000n * SCALE;
const k = baseAssetReserve * quoteAssetReserve;
const indexPrice = 20n * SCALE;

describe("vAMM math", () => {
  it("computes mark price with SCALE", () => {
    expect(markPrice({ baseAssetReserve, quoteAssetReserve, k })).toBe(20n * SCALE);
  });

  it("opens a long and moves reserves correctly", () => {
    const margin = LAMPORTS_PER_SOL / 10n;
    const notional = notionalUsdFromLamports(margin, 5n, indexPrice);
    const opened = openLong(
      { baseAssetReserve, quoteAssetReserve, k },
      notional,
      margin,
      indexPrice,
    );

    expect(opened.size).toBeGreaterThan(0n);
    expect(opened.quoteAssetReserve).toBe(quoteAssetReserve + notional);
    expect(opened.baseAssetReserve).toBeLessThan(baseAssetReserve);
  });

  it("opens a short and moves reserves correctly", () => {
    const margin = LAMPORTS_PER_SOL / 10n;
    const notional = notionalUsdFromLamports(margin, 5n, indexPrice);
    const opened = openShort(
      { baseAssetReserve, quoteAssetReserve, k },
      notional,
      margin,
      indexPrice,
    );

    expect(opened.size).toBeGreaterThan(0n);
    expect(opened.quoteAssetReserve).toBe(quoteAssetReserve - notional);
    expect(opened.baseAssetReserve).toBeGreaterThan(baseAssetReserve);
  });

  it("close long is profitable after mark price rises", () => {
    const margin = LAMPORTS_PER_SOL / 10n;
    const opened = openLong(
      { baseAssetReserve, quoteAssetReserve, k },
      10n * SCALE,
      margin,
      indexPrice,
    );
    const moved = {
      baseAssetReserve: opened.baseAssetReserve - 1_000n * SCALE,
      quoteAssetReserve:
        k / (opened.baseAssetReserve - 1_000n * SCALE),
      k,
    };
    const closed = closePosition(moved, {
      direction: "long",
      size: opened.size,
      notional: opened.notional,
      entryPrice: opened.entryPrice,
      marginLamports: margin,
    });

    expect(closed.pnlUsd).toBeGreaterThan(0n);
  });

  it("negative equity returns margin ratio zero", () => {
    expect(marginRatio(1n, -1_000_000n * SCALE, 10n * SCALE, indexPrice)).toBe(0n);
  });

  it("rejects short reserve exhaustion", () => {
    expect(() =>
      openShort(
        { baseAssetReserve, quoteAssetReserve, k },
        quoteAssetReserve,
        LAMPORTS_PER_SOL,
        indexPrice,
      ),
    ).toThrow(/quote reserve/);
  });

  it("computes trading fees from notional lamports", () => {
    expect(tradingFeeLamports(LAMPORTS_PER_SOL, 10n)).toBe(10_000_000n);
  });

  it("maintenance margin constant is scaled", () => {
    expect(MAINTENANCE_MARGIN).toBe(62_500n);
  });
});
