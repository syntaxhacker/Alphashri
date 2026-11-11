/**
 * Symbol-specific metrics derived from a live/replay report.
 *
 * Replaces all hard-coded NIFTY-calibrated constants with values that scale
 * to SENSEX (~79k, 100-pt step, lot 20), RELIANCE (~1.4k, 50-pt step, lot 500),
 * and any other F&O underlying.
 *
 * Pure: no React, no clock, no network.
 */

import type { NiftyReport, NiftyStrike, NiftyWall } from "@/types/niftyReport";

export interface SymbolMetrics {
  /** Spot price from the report. */
  spot: number;
  /** Strike step (minimum positive difference between sorted unique strikes). */
  strikeStep: number;
  /** Contract lot size (from positioning block or fallback). */
  lotSize: number;
  /** Total CE + PE open interest (contracts) — used for relative flow noise. */
  totalOi: number;
  /** Maximum wall OI across calls and puts (contracts) — used for relative wall gate. */
  maxWallOi: number;

  // --- Derived thresholds ---

  /** Max-pain touch tolerance in points (20% of strike step, min 1). */
  maxPainTouchTol: number;
  /** Pin edge HIGH: spot within this many points of a significant wall. */
  pinEdgeHigh: number;
  /** Pin edge MEDIUM: wider "approaching the level" band. */
  pinEdgeMedium: number;
  /** Pin pain threshold: max pain must be at least this far from spot. */
  pinPainPts: number;
  /** Wall gate: max distance from spot to the nearest call/put wall. */
  wallMaxDist: number;
  /** Wall gate: minimum OI for a wall to be significant (contracts).
   *  Relative: 25% of max wall OI, with 500k conservative floor.
   *  Validated: NIFTY ~11M → 2.75M gate; SENSEX ~7.5M → 1.875M gate; RELIANCE ~14M → 3.5M gate. */
  wallMinOi: number;
  /** Level gate: max distance from spot to a pivot / prior-day level. */
  levelMaxDist: number;
  /** Heatmap width around ATM in points (5 strike steps). */
  heatmapWidthPts: number;
  /** ATM window for "at the money" classification in points (15 strike steps). */
  atmWindowPts: number;

  // --- Flow noise (contracts) ---
  /** Absolute noise floor for the 1-minute OI read (lowered from 100k to 50k).
   *  Validated: SENSEX 1-min avg ~940k, max ~5.5M; RELIANCE 1-min avg ~74k, max ~317k. */
  flowNoise: number;
  /** Relative noise floor: fraction of total CE+PE OI (0.1% = 0.001).
   *  Validated: SENSEX totalOi ~170M → 170k; RELIANCE totalOi ~50M → 50k. */
  flowNoiseRel: number;
  /** Effective noise used by readers: max(absolute, relative * totalOi). */
  effectiveFlowNoise: number;

  // --- Squeeze radar (basis points of spot) ---
  /** Distance gauge range in basis points (NIFTY: 120/22800 ≈ 52.6 bps). */
  squeezeRangeBps: number;
  /** Price-break threshold for TRIGGER in basis points (NIFTY: 10/22800 ≈ 4.4 bps). */
  squeezePriceBreakBps: number;
  /** "At the wall" threshold in basis points (NIFTY: 5/22800 ≈ 2.2 bps). */
  squeezeAtWallBps: number;
  /** Effective distance gauge range in points (spot * squeezeRangeBps / 10000). */
  squeezeRangePts: number;
  /** Effective price-break threshold in points. */
  squeezePriceBreakPts: number;
  /** Effective "at the wall" threshold in points. */
  squeezeAtWallPts: number;
}

/** Fallback strike step when the chain is too sparse to derive one. */
const DEFAULT_STRIKE_STEP = 50;
/** Fallback lot size when unresolved. */
const DEFAULT_LOT_SIZE = 1;
/** Default absolute flow noise (contracts) — lowered from 100k to 50k for RELIANCE. */
const DEFAULT_FLOW_NOISE = 50_000;
/** Default relative flow noise fraction (0.1% of total OI) — increased from 0.05%. */
const DEFAULT_FLOW_NOISE_REL = 0.001;
/** Wall gate: relative fraction of max wall OI (25%). */
const WALL_MIN_OI_FRACTION = 0.25;
/** Wall gate: conservative floor (contracts). */
const WALL_MIN_OI_FLOOR = 500_000;

/** NIFTY calibration reference points (preserved for backward compatibility). */
const NIFTY_REF_SPOT = 22800;
const NIFTY_SQUEEZE_RANGE_PTS = 120;
const NIFTY_SQUEEZE_PRICE_BREAK_PTS = 10;
const NIFTY_SQUEEZE_AT_WALL_PTS = 5;

/**
 * Derive the strike step from the report's strike array.
 * Returns the minimum positive difference between sorted unique strikes.
 */
function deriveStrikeStep(strikes: readonly NiftyStrike[]): number {
  const unique = Array.from(new Set(strikes.map((s) => s.strike)))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  if (unique.length < 2) return DEFAULT_STRIKE_STEP;
  let minDiff = Infinity;
  for (let i = 1; i < unique.length; i++) {
    const diff = unique[i] - unique[i - 1];
    if (diff > 0 && diff < minDiff) minDiff = diff;
  }
  return Number.isFinite(minDiff) && minDiff > 0 ? minDiff : DEFAULT_STRIKE_STEP;
}

/** Sum CE + PE OI across all strikes (contracts). */
function computeTotalOi(strikes: readonly NiftyStrike[]): number {
  let total = 0;
  for (const s of strikes) {
    total += (s.ce?.oi ?? 0) + (s.pe?.oi ?? 0);
  }
  return total;
}

/** Maximum wall OI from report.walls (calls and puts combined). */
function computeMaxWallOi(walls?: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null): number {
  let maxOi = 0;
  for (const w of walls?.calls ?? []) {
    if (typeof w.oi === "number" && w.oi > maxOi) maxOi = w.oi;
  }
  for (const w of walls?.puts ?? []) {
    if (typeof w.oi === "number" && w.oi > maxOi) maxOi = w.oi;
  }
  return maxOi;
}

/** Resolve lot size from the report's positioning block or chain. */
function resolveLotSize(report: NiftyReport): number {
  // Primary: positioning.lot_size (set by the backend from the chain)
  const posLot = report.positioning?.lotSize;
  if (typeof posLot === "number" && posLot > 0) return posLot;
  // Fallback: default
  return DEFAULT_LOT_SIZE;
}

/**
 * Compute symbol-specific metrics from a report.
 * All thresholds scale with strikeStep and spot — no hard-coded NIFTY values.
 */
export function symbolMetrics(report: NiftyReport): SymbolMetrics {
  const spot = report.spot ?? 0;
  const strikes = report.strikes ?? [];
  const strikeStep = deriveStrikeStep(strikes);
  const lotSize = resolveLotSize(report);
  const totalOi = computeTotalOi(strikes);
  const maxWallOi = computeMaxWallOi(report.walls);

  // Derived point thresholds (scale with strike step)
  const maxPainTouchTol = Math.max(1, Math.round(strikeStep * 0.2));
  const pinEdgeHigh = strikeStep;
  const pinEdgeMedium = strikeStep * 2;
  const pinPainPts = strikeStep * 2;
  const wallMaxDist = strikeStep * 2;
  // Wall gate: relative to max wall OI (25%), with 500k floor
  const wallMinOi = maxWallOi > 0
    ? Math.max(WALL_MIN_OI_FLOOR, Math.round(maxWallOi * WALL_MIN_OI_FRACTION))
    : WALL_MIN_OI_FLOOR;
  const levelMaxDist = Math.round(strikeStep * 1.2);
  const heatmapWidthPts = strikeStep * 5;
  const atmWindowPts = strikeStep * 15;

  // Flow noise: absolute floor (50k) + relative to total OI (0.1%)
  const flowNoise = DEFAULT_FLOW_NOISE;
  const flowNoiseRel = DEFAULT_FLOW_NOISE_REL;
  const effectiveFlowNoise = Math.max(flowNoise, Math.round(totalOi * flowNoiseRel));

  // Squeeze radar: preserve NIFTY behavior in basis points of spot
  const squeezeRangeBps = Math.round((NIFTY_SQUEEZE_RANGE_PTS / NIFTY_REF_SPOT) * 10000);
  const squeezePriceBreakBps = Math.round((NIFTY_SQUEEZE_PRICE_BREAK_PTS / NIFTY_REF_SPOT) * 10000);
  const squeezeAtWallBps = Math.round((NIFTY_SQUEEZE_AT_WALL_PTS / NIFTY_REF_SPOT) * 10000);

  const squeezeRangePts = Math.max(1, Math.round((spot * squeezeRangeBps) / 10000));
  const squeezePriceBreakPts = Math.max(1, Math.round((spot * squeezePriceBreakBps) / 10000));
  const squeezeAtWallPts = Math.max(1, Math.round((spot * squeezeAtWallBps) / 10000));

  return {
    spot,
    strikeStep,
    lotSize,
    totalOi,
    maxWallOi,
    maxPainTouchTol,
    pinEdgeHigh,
    pinEdgeMedium,
    pinPainPts,
    wallMaxDist,
    wallMinOi,
    levelMaxDist,
    heatmapWidthPts,
    atmWindowPts,
    flowNoise,
    flowNoiseRel,
    effectiveFlowNoise,
    squeezeRangeBps,
    squeezePriceBreakBps,
    squeezeAtWallBps,
    squeezeRangePts,
    squeezePriceBreakPts,
    squeezeAtWallPts,
  };
}

/** Backward-compatible helpers for callers that only need one metric. */
export function maxPainTouchTol(report: NiftyReport): number {
  return symbolMetrics(report).maxPainTouchTol;
}
export function pinEdgeHigh(report: NiftyReport): number {
  return symbolMetrics(report).pinEdgeHigh;
}
export function pinEdgeMedium(report: NiftyReport): number {
  return symbolMetrics(report).pinEdgeMedium;
}
export function pinPainPts(report: NiftyReport): number {
  return symbolMetrics(report).pinPainPts;
}
export function wallMaxDist(report: NiftyReport): number {
  return symbolMetrics(report).wallMaxDist;
}
export function wallMinOi(report: NiftyReport): number {
  return symbolMetrics(report).wallMinOi;
}
export function levelMaxDist(report: NiftyReport): number {
  return symbolMetrics(report).levelMaxDist;
}
export function heatmapWidthPts(report: NiftyReport): number {
  return symbolMetrics(report).heatmapWidthPts;
}
export function atmWindowPts(report: NiftyReport): number {
  return symbolMetrics(report).atmWindowPts;
}
export function flowNoiseFor(report: NiftyReport): number {
  return symbolMetrics(report).effectiveFlowNoise;
}
export function squeezeRangePts(report: NiftyReport): number {
  return symbolMetrics(report).squeezeRangePts;
}
export function squeezePriceBreakPts(report: NiftyReport): number {
  return symbolMetrics(report).squeezePriceBreakPts;
}
export function squeezeAtWallPts(report: NiftyReport): number {
  return symbolMetrics(report).squeezeAtWallPts;
}

/** Test fixtures for SENSEX and RELIANCE (not exported to production code). */
export const TEST_FIXTURES = {
  /** SENSEX: ~79,000 spot, 100-pt strike step, lot 20 */
  sensex: {
    spot: 79_000,
    strikeStep: 100,
    lotSize: 20,
  },
  /** RELIANCE: ~1,400 spot, 50-pt strike step, lot 500 */
  reliance: {
    spot: 1_400,
    strikeStep: 50,
    lotSize: 500,
  },
  /** NIFTY: ~22,800 spot, 50-pt strike step, lot 65 */
  nifty: {
    spot: 22_800,
    strikeStep: 50,
    lotSize: 65,
  },
} as const;