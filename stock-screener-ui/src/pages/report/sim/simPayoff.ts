import {
  breakevens,
  curveSpots,
  maxLossAtExpiry,
  maxProfitAtExpiry,
  payoffCurve,
  type PayoffLeg,
} from "@/components/options/PremiumTracker/payoff";
import type { SimPayoff, SimResolvedLeg } from "@/types/reportSim";

export interface PayoffSummary {
  /** null when the upside is unbounded. */
  maxProfit: number | null;
  /** null when the downside is unbounded; otherwise <= 0. */
  maxLoss: number | null;
  breakevens: number[];
  spots: number[];
}

export function toPayoffLegs(legs: SimResolvedLeg[]): PayoffLeg[] {
  return legs.map((l) => ({
    strike: l.strike,
    optionType: l.opt,
    action: l.action,
    qty: l.qty,
    entry: l.entryPremium,
  }));
}

export function spotsFor(legs: PayoffLeg[], pct = 8, n = 161): number[] {
  if (legs.length === 0 || n <= 0) return [];
  const strikes = legs
    .map((l) => l.strike)
    .filter((s) => Number.isFinite(s) && s > 0);
  if (strikes.length === 0) return [];
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  // Centre the window on the structure so both wings stay visible.
  const center = (lo + hi) / 2;
  return curveSpots(center, pct, n).filter((s) => Number.isFinite(s) && s > 0);
}

export function payoffSeries(legs: PayoffLeg[], spots?: number[]): SimPayoff {
  const grid = spots && spots.length > 0 ? spots : spotsFor(legs);
  if (legs.length === 0 || grid.length === 0) return { spots: [], expiry: [] };
  return {
    spots: grid,
    expiry: payoffCurve(legs, grid).map((p) => p.pnl),
  };
}

export function payoffSummary(legs: PayoffLeg[]): PayoffSummary {
  if (legs.length === 0) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], spots: [] };
  }
  const spots = spotsFor(legs);
  if (spots.length === 0) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], spots: [] };
  }
  return {
    maxProfit: maxProfitAtExpiry(legs),
    maxLoss: maxLossAtExpiry(legs),
    breakevens: breakevens(legs, spots[0], spots[spots.length - 1]),
    spots,
  };
}
