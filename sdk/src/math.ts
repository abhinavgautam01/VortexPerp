import {
  LAMPORTS_PER_SOL,
  MAINTENANCE_MARGIN,
  SCALE,
  TRADING_FEE_BPS,
} from "./constants.js";

export type Direction = "long" | "short";

export interface VammMathState {
  baseAssetReserve: bigint;
  quoteAssetReserve: bigint;
  k: bigint;
}

export interface PositionMathState {
  size: bigint;
  notional: bigint;
  direction: Direction;
  entryPrice: bigint;
  marginLamports: bigint;
}

export function markPrice(vamm: VammMathState): bigint {
  if (vamm.baseAssetReserve <= 0n) throw new Error("base reserve is zero");
  return (vamm.quoteAssetReserve * SCALE) / vamm.baseAssetReserve;
}

export function notionalUsdFromLamports(
  marginLamports: bigint,
  leverage: bigint,
  indexPrice: bigint,
): bigint {
  return (marginLamports * leverage * indexPrice) / LAMPORTS_PER_SOL;
}

export function tradingFeeLamports(
  marginLamports: bigint,
  leverage: bigint,
): bigint {
  return (marginLamports * leverage * TRADING_FEE_BPS) / 10_000n;
}

export function openLong(
  vamm: VammMathState,
  quoteAmount: bigint,
  marginLamports: bigint,
  indexPrice: bigint,
) {
  const newQuoteReserve = vamm.quoteAssetReserve + quoteAmount;
  const newBaseReserve = vamm.k / newQuoteReserve;
  const size = vamm.baseAssetReserve - newBaseReserve;
  if (size <= 0n) throw new Error("zero-size long");
  const entryPrice = (quoteAmount * SCALE) / size;
  return {
    size,
    notional: quoteAmount,
    entryPrice,
    liquidationPrice: liquidationPrice(
      "long",
      entryPrice,
      size,
      quoteAmount,
      marginLamports,
      indexPrice,
    ),
    baseAssetReserve: newBaseReserve,
    quoteAssetReserve: newQuoteReserve,
  };
}

export function openShort(
  vamm: VammMathState,
  quoteAmount: bigint,
  marginLamports: bigint,
  indexPrice: bigint,
) {
  if (quoteAmount >= vamm.quoteAssetReserve) {
    throw new Error("short exhausts quote reserve");
  }
  const newQuoteReserve = vamm.quoteAssetReserve - quoteAmount;
  const newBaseReserve = vamm.k / newQuoteReserve;
  const size = newBaseReserve - vamm.baseAssetReserve;
  if (size <= 0n) throw new Error("zero-size short");
  const entryPrice = (quoteAmount * SCALE) / size;
  return {
    size,
    notional: quoteAmount,
    entryPrice,
    liquidationPrice: liquidationPrice(
      "short",
      entryPrice,
      size,
      quoteAmount,
      marginLamports,
      indexPrice,
    ),
    baseAssetReserve: newBaseReserve,
    quoteAssetReserve: newQuoteReserve,
  };
}

export function closePosition(vamm: VammMathState, position: PositionMathState) {
  if (position.direction === "long") {
    const newBaseReserve = vamm.baseAssetReserve + position.size;
    const newQuoteReserve = vamm.k / newBaseReserve;
    const quoteReceived = vamm.quoteAssetReserve - newQuoteReserve;
    const exitPrice = (quoteReceived * SCALE) / position.size;
    return {
      exitNotional: quoteReceived,
      exitPrice,
      pnlUsd: quoteReceived - position.notional,
      baseAssetReserve: newBaseReserve,
      quoteAssetReserve: newQuoteReserve,
    };
  }

  const newBaseReserve = vamm.baseAssetReserve - position.size;
  const newQuoteReserve = vamm.k / newBaseReserve;
  const quoteToRepay = newQuoteReserve - vamm.quoteAssetReserve;
  const exitPrice = (quoteToRepay * SCALE) / position.size;
  return {
    exitNotional: quoteToRepay,
    exitPrice,
    pnlUsd: position.notional - quoteToRepay,
    baseAssetReserve: newBaseReserve,
    quoteAssetReserve: newQuoteReserve,
  };
}

export function liquidationPrice(
  direction: Direction,
  entryPrice: bigint,
  size: bigint,
  notional: bigint,
  marginLamports: bigint,
  indexPrice: bigint,
): bigint {
  const marginUsd = (marginLamports * indexPrice) / LAMPORTS_PER_SOL;
  const maintenance = (notional * MAINTENANCE_MARGIN) / SCALE;
  if (marginUsd <= maintenance) throw new Error("below maintenance");
  const bufferUsd = marginUsd - maintenance;
  const bufferPrice = (bufferUsd * SCALE) / size;
  return direction === "long"
    ? entryPrice > bufferPrice
      ? entryPrice - bufferPrice
      : 0n
    : entryPrice + bufferPrice;
}

export function marginRatio(
  marginLamports: bigint,
  pnlUsd: bigint,
  notional: bigint,
  indexPrice: bigint,
): bigint {
  const marginUsd = (marginLamports * indexPrice) / LAMPORTS_PER_SOL;
  const equity = marginUsd + pnlUsd;
  if (equity <= 0n) return 0n;
  return (equity * SCALE) / notional;
}

export function formatScaled(value: bigint, decimals = 6): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(6, "0").slice(0, decimals);
  return `${sign}${whole.toString()}${decimals > 0 ? `.${fraction}` : ""}`;
}
