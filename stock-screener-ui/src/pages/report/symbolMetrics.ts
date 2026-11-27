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
import { flowNoiseFor as baseFlowNoiseFor } from "./niftyFlowRead";
import { maxPainTouchTol as baseMaxPainTouchTol } from "./maxPainTouches";

export interface SymbolMetrics {
  spot: number;
  strikeStep: number;
  /** Contract lot size (from positioning block or fallback). */
  lotSize: number;
  totalOi: number;
  maxWallOi: number;


  maxPainTouchTol: number;
  pinEdgeHigh: number;
  pinEdgeMedium: number;
  pinPainPts: number;
  wallMaxDist: number;
  wallMinOi: number;
  levelMaxDist: number;
  heatmapWidthPts: number;
  atmWindowPts: number;

  flowNoise: number;
  flowNoiseRel: number;
  effectiveFlowNoise: number;

  squeezeRangeBps: number;
  squeezePriceBreakBps: number;
  squeezeAtWallBps: number;
  squeezeRangePts: number;
  squeezePriceBreakPts: number;
  squeezeAtWallPts: number;
}

const DEFAULT_STRIKE_STEP = 50;
const DEFAULT_LOT_SIZE = 1;
const DEFAULT_FLOW_NOISE = 50_000;
const DEFAULT_FLOW_NOISE_REL = 0.001;
const WALL_MIN_OI_FRACTION = 0.25;
const WALL_MIN_OI_FLOOR = 500_000;

const NIFTY_REF_SPOT = 22800;
const NIFTY_SQUEEZE_RANGE_PTS = 120;
const NIFTY_SQUEEZE_PRICE_BREAK_PTS = 10;
const NIFTY_SQUEEZE_AT_WALL_PTS = 5;

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

function computeTotalOi(strikes: readonly NiftyStrike[]): number {
  let total = 0;
  for (const s of strikes) {
    total += (s.ce?.oi ?? 0) + (s.pe?.oi ?? 0);
  }
  return total;
}

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

function resolveLotSize(report: NiftyReport): number {
  // Primary: positioning.lot_size (set by the backend from the chain)
  const posLot = report.positioning?.lotSize;
  if (typeof posLot === "number" && posLot > 0) return posLot;
  return DEFAULT_LOT_SIZE;
}

export function symbolMetrics(report: NiftyReport): SymbolMetrics {
  const spot = report.spot ?? 0;
  const strikes = report.strikes ?? [];
  const strikeStep = deriveStrikeStep(strikes);
  const lotSize = resolveLotSize(report);
  const totalOi = computeTotalOi(strikes);
  const maxWallOi = computeMaxWallOi(report.walls);

  const maxPainTouchTol = baseMaxPainTouchTol({ strikes });
  const pinEdgeHigh = strikeStep;
  const pinEdgeMedium = strikeStep * 2;
  const pinPainPts = strikeStep * 2;
  const wallMaxDist = strikeStep * 2;
  const wallMinOi = maxWallOi > 0
    ? Math.max(WALL_MIN_OI_FLOOR, Math.round(maxWallOi * WALL_MIN_OI_FRACTION))
    : WALL_MIN_OI_FLOOR;
  const levelMaxDist = Math.round(strikeStep * 1.2);
  const heatmapWidthPts = strikeStep * 5;
  const atmWindowPts = strikeStep * 15;

  const flowNoise = DEFAULT_FLOW_NOISE;
  const flowNoiseRel = DEFAULT_FLOW_NOISE_REL;
  const effectiveFlowNoise = baseFlowNoiseFor({ strikes });

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
export { baseMaxPainTouchTol as maxPainTouchTol, baseFlowNoiseFor as flowNoiseFor };
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
export function squeezeRangePts(report: NiftyReport): number {
  return symbolMetrics(report).squeezeRangePts;
}
export function squeezePriceBreakPts(report: NiftyReport): number {
  return symbolMetrics(report).squeezePriceBreakPts;
}
export function squeezeAtWallPts(report: NiftyReport): number {
  return symbolMetrics(report).squeezeAtWallPts;
}