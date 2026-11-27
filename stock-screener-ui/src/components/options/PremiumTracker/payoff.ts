import {
  payoffAt as canonicalPayoffAt,
  payoffCurve as canonicalPayoffCurve,
  type OptionLeg,
} from "@/utils/optionsMath";

export interface PayoffLeg {
  strike: number;
  optionType: "CE" | "PE";
  action: "BUY" | "SELL";
  qty: number;
  entry: number;
}

/** The simulator's leg shape mapped onto the canonical options-dock leg. */
function toOptionLegs(legs: readonly PayoffLeg[]): OptionLeg[] {
  return legs.map((leg): OptionLeg => ({
    side: leg.action === "BUY" ? "buy" : "sell",
    type: leg.optionType,
    strike: leg.strike,
    premium: leg.entry,
    lots: leg.qty,
    lotSize: 1,
  }));
}

/** optionsMath needs a spot for its chart window; analytic facts only need it past every strike. */
function referenceSpot(legs: readonly PayoffLeg[]): number {
  const strikes = legs
    .map((leg) => leg.strike)
    .filter((strike) => Number.isFinite(strike) && strike > 0);
  if (strikes.length === 0) return 1;
  return (Math.min(...strikes) + Math.max(...strikes)) / 2;
}

function analyse(legs: readonly PayoffLeg[]) {
  return canonicalPayoffCurve(toOptionLegs(legs), referenceSpot(legs));
}

/**
 * Net debit (> 0). The canonical netPremium is credit-positive, so the adapter
 * negates it to keep this module's documented debit/credit sign for consumers.
 */
export function netEntry(legs: PayoffLeg[]): number {
  const netPremium = analyse(legs).netPremium;
  return netPremium === 0 ? 0 : -netPremium;
}

/** Total P&L at expiry for a given spot. Never mutates inputs. */
export function payoffAtExpiry(legs: PayoffLeg[], spot: number): number {
  return canonicalPayoffAt(spot, toOptionLegs(legs));
}

/** P&L evaluated at each spot. Never mutates inputs. */
export function payoffCurve(
  legs: PayoffLeg[],
  spots: number[],
): { spot: number; pnl: number }[] {
  if (legs.length === 0) return [];
  const optionLegs = toOptionLegs(legs);
  return spots.map((spot) => ({ spot, pnl: canonicalPayoffAt(spot, optionLegs) }));
}

/** n evenly spaced spots from spot*(1-pctRange/100) to spot*(1+pctRange/100). */
export function curveSpots(spot: number, pctRange = 8, n = 61): number[] {
  if (n <= 0) return [];
  if (n === 1) return [spot];
  const lo = spot * (1 - pctRange / 100);
  const hi = spot * (1 + pctRange / 100);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(lo + ((hi - lo) * i) / (n - 1));
  }
  return out;
}

/**
 * dPnL/dS as spot → 0, from the PE legs only. optionsMath only tests the far
 * right (CE) tail, so a net-long put's left tail would otherwise read as a
 * finite max profit here; consumers treat a still-rising tail as unbounded.
 */
function leftTailSlope(legs: readonly PayoffLeg[]): number {
  let slope = 0;
  for (const leg of legs) {
    if (leg.optionType === "PE") {
      slope += (leg.action === "BUY" ? 1 : -1) * leg.qty;
    }
  }
  return -slope;
}

/** Analytic expiry breakevens. lo/hi are kept for signature compatibility only. */
export function breakevens(legs: PayoffLeg[], _lo: number, _hi: number): number[] {
  if (legs.length === 0) return [];
  return analyse(legs).breakevens;
}

/** Max profit at expiry, or null when either tail is unbounded. */
export function maxProfitAtExpiry(legs: PayoffLeg[]): number | null {
  if (legs.length === 0) return 0;
  const result = analyse(legs);
  if (result.maxProfit === null || leftTailSlope(legs) < 0) return null;
  return result.maxProfit;
}

/** Max loss at expiry (as a <= 0 number), or null when either tail is unbounded. */
export function maxLossAtExpiry(legs: PayoffLeg[]): number | null {
  if (legs.length === 0) return 0;
  const result = analyse(legs);
  if (result.maxLoss === null || leftTailSlope(legs) > 0) return null;
  return result.maxLoss;
}
