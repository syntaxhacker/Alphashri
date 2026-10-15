export interface PayoffLeg {
  strike: number;
  optionType: "CE" | "PE";
  action: "BUY" | "SELL";
  qty: number;
  entry: number;
}

function legSign(leg: PayoffLeg): number {
  return leg.action === "SELL" ? -1 : 1;
}

function intrinsic(leg: PayoffLeg, spot: number): number {
  if (leg.optionType === "CE") return Math.max(0, spot - leg.strike);
  return Math.max(0, leg.strike - spot);
}

/** Net debit (> 0) of the position: per-unit premium x qty, SELL legs negated. */
export function netEntry(legs: PayoffLeg[]): number {
  return legs.reduce((sum, leg) => sum + legSign(leg) * leg.entry * leg.qty, 0);
}

/** Total P&L at expiry for a given spot. Never mutates inputs. */
export function payoffAtExpiry(legs: PayoffLeg[], spot: number): number {
  return legs.reduce(
    (sum, leg) => sum + legSign(leg) * (intrinsic(leg, spot) - leg.entry) * leg.qty,
    0,
  );
}

/** P&L evaluated at each spot. Never mutates inputs. */
export function payoffCurve(
  legs: PayoffLeg[],
  spots: number[],
): { spot: number; pnl: number }[] {
  if (legs.length === 0) return [];
  return spots.map((spot) => ({ spot, pnl: payoffAtExpiry(legs, spot) }));
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

/** Range extremes of curveSpots(100, 8), used to scale probe ranges off strikes. */
const BASE_LO_FACTOR = curveSpots(100, 8)[0] / 100;
const BASE_HI_FACTOR = curveSpots(100, 8)[curveSpots(100, 8).length - 1] / 100;

function probeRange(legs: PayoffLeg[]): { lo: number; hi: number } {
  const strikes = legs.map((leg) => leg.strike);
  const minStrike = Math.min(...strikes);
  const maxStrike = Math.max(...strikes);
  const loRef = minStrike > 0 ? minStrike : 100;
  const hiRef = maxStrike > 0 ? maxStrike : 100;
  return { lo: loRef * BASE_LO_FACTOR, hi: hiRef * BASE_HI_FACTOR };
}

const SCAN_STEPS = 400;
const BISECT_ITERS = 40;
const EPS = 1e-9;

/**
 * Find expiry breakevens within [lo, hi]: scan 400 steps for sign changes of
 * payoffAtExpiry, refine each by 40 bisection iterations, round to 1 decimal,
 * dedupe. Candidates are confirmed by checking strictly opposite signs on
 * both sides, so flat zero regions (e.g. zero-entry drafts) and touches that
 * never cross report nothing. Capped at 8 results. Returns [] for empty legs.
 */
export function breakevens(legs: PayoffLeg[], lo: number, hi: number): number[] {
  if (legs.length === 0 || !(lo < hi)) return [];
  const found: number[] = [];
  const f = (s: number): number => payoffAtExpiry(legs, s);
  let prevS = lo;
  let prevV = f(lo);
  if (prevV === 0) found.push(prevS);
  for (let i = 1; i <= SCAN_STEPS; i += 1) {
    const s = lo + ((hi - lo) * i) / SCAN_STEPS;
    const v = f(s);
    if (v === 0) {
      found.push(s);
    } else if (prevV !== 0 && Math.sign(v) !== Math.sign(prevV)) {
      let a = prevS;
      let b = s;
      let fa = prevV;
      for (let k = 0; k < BISECT_ITERS; k += 1) {
        const mid = (a + b) / 2;
        const fm = f(mid);
        if (fm === 0) {
          a = mid;
          b = mid;
          break;
        }
        if (Math.sign(fm) === Math.sign(fa)) {
          a = mid;
          fa = fm;
        } else {
          b = mid;
        }
      }
      found.push((a + b) / 2);
    }
    prevS = s;
    prevV = v;
  }
  const tick = (hi - lo) / SCAN_STEPS;
  const rounded = found.map((s) => Math.round(s * 10) / 10);
  const unique = [...new Set(rounded)].sort((a, b) => a - b);
  const confirmed = unique.filter((be) => {
    const below = f(be - tick);
    const above = f(be + tick);
    return (below < 0 && above > 0) || (below > 0 && above < 0);
  });
  return confirmed.slice(0, 8);
}

/** Dense scan over the probe range plus every strike kink. */
function denseScan(legs: PayoffLeg[]): number[] {
  const { lo, hi } = probeRange(legs);
  const top = hi * 1.5;
  const out: number[] = [];
  for (let i = 0; i <= SCAN_STEPS; i += 1) {
    out.push(lo + ((top - lo) * i) / SCAN_STEPS);
  }
  for (const leg of legs) {
    out.push(leg.strike);
  }
  return out;
}

/**
 * Max profit at expiry, or null when unbounded (upside slope positive beyond
 * the probe high, or downside slope still rising when moving down from the
 * probe low). Returns 0 for empty legs.
 */
export function maxProfitAtExpiry(legs: PayoffLeg[]): number | null {
  if (legs.length === 0) return 0;
  const { lo, hi } = probeRange(legs);
  const up = payoffAtExpiry(legs, hi * 1.5);
  if (up > payoffAtExpiry(legs, hi) + EPS) return null;
  const down = payoffAtExpiry(legs, lo / 1.5);
  if (down > payoffAtExpiry(legs, lo) + EPS) return null;
  let best = -Infinity;
  for (const s of denseScan(legs)) {
    const v = payoffAtExpiry(legs, s);
    if (v > best) best = v;
  }
  return best;
}

/**
 * Max loss at expiry (as a <= 0 number), or null when unbounded (payoff still
 * falling beyond the probe high on the upside, or below the probe low on the
 * downside). Returns 0 for empty legs.
 */
export function maxLossAtExpiry(legs: PayoffLeg[]): number | null {
  if (legs.length === 0) return 0;
  const { lo, hi } = probeRange(legs);
  const up = payoffAtExpiry(legs, hi * 1.5);
  if (up < payoffAtExpiry(legs, hi) - EPS) return null;
  const down = payoffAtExpiry(legs, lo / 1.5);
  if (down < payoffAtExpiry(legs, lo) - EPS) return null;
  let worst = Infinity;
  for (const s of denseScan(legs)) {
    const v = payoffAtExpiry(legs, s);
    if (v < worst) worst = v;
  }
  return worst;
}
