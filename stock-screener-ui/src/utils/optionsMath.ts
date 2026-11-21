/**
 * Pure options arithmetic for the options dock — payoff, breakevens, lognormal
 * probability, greeks aggregation and OI aggregates.
 *
 * Everything here is *model* arithmetic over server-supplied inputs (spot,
 * strikes, premiums, IV): it never fetches, reads a store or touches the DOM,
 * because a leg change must cost zero requests (plan §6, budget #7).
 *
 * **Time basis is a 365-day calendar year** (plan §5.2). The feed's IV is
 * quoted on calendar time; a 252-day basis would inflate ±1σ by √(365/252) =
 * 1.20× and silently disagree with the option prices it was derived from.
 */

import { DERIVATIVES_CLOSE_MIN, istClock } from "./marketClock";

export type Side = "buy" | "sell";
export type OptionType = "CE" | "PE";

export interface OptionLeg {
  side: Side;
  type: OptionType;
  strike: number;
  premium: number;
  lots: number;
  lotSize: number;
}

export interface PayoffPoint {
  spot: number;
  pnl: number;
}

interface PayoffResult {
  points: PayoffPoint[];
  breakevens: number[];
  maxProfit: number | null;
  maxLoss: number | null;
  netPremium: number;
}

/** Default chart window: ±10 % of spot (plan §10, decision 5). */
const DEFAULT_WIDTH_PCT = 0.1;
/** Payoff / density sample count. 241 nodes = 240 cells, 0.0x % of spot apart. */
const DEFAULT_POINTS = 241;
/**
 * `T` floor of 15 minutes (plan §5.6). Also covers dteYears ≤ 0 and NaN: a
 * zero T makes σ√T collapse and every probability becomes 0 or 1.
 */
const MIN_DTE_YEARS = 15 / (365 * 24 * 60);
/** Beyond the last strike the payoff is linear; this sentinel only needs to be past every kink. */
const SENTINEL_SPAN = 1;

/** +1 for a bought leg, −1 for a sold leg. */
function legSign(leg: OptionLeg): number {
  return leg.side === "buy" ? 1 : -1;
}

/** Units of the underlying carried by one leg: lots × lot size. */
function legUnits(leg: OptionLeg): number {
  return leg.lots * leg.lotSize;
}

function intrinsic(spot: number, strike: number, type: OptionType): number {
  if (type === "CE") return spot > strike ? spot - strike : 0;
  return strike > spot ? strike - spot : 0;
}

/**
 * Credit-positive net premium. A sold leg collects, a bought leg pays, so an
 * iron condor shows the credit it actually received (₹3 536 on the §4.1 set).
 */
function netPremiumOf(legs: readonly OptionLeg[]): number {
  let net = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    net -= legSign(leg) * legUnits(leg) * leg.premium;
  }
  return net;
}

/**
 * Standard normal CDF — Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7.
 * Written out rather than imported so this module stays dependency-free.
 */
function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = 0.3989422804014327 * Math.exp(-0.5 * ax * ax) * poly;
  return x >= 0 ? 1 - tail : tail;
}

/** Lognormal state for the probability model: log sd and log drift (r = 0). */
interface LogModel {
  sigmaLog: number;
  /** ln S_T ~ N(mu, sigmaLog²); zero drift in price means mu = −σ²/2. */
  mu: number;
  /** Price-point 1σ, i.e. how far S_T typically moves. */
  sigmaPts: number;
}

function logModel(spot: number, iv: number, dteYears: number): LogModel | null {
  if (!(spot > 0) || !Number.isFinite(spot)) return null;
  if (!(iv > 0) || !Number.isFinite(iv)) return null;
  const tYears = Number.isFinite(dteYears) ? Math.max(dteYears, MIN_DTE_YEARS) : MIN_DTE_YEARS;
  const sigmaLog = iv * Math.sqrt(tYears);
  if (!(sigmaLog > 0) || !Number.isFinite(sigmaLog)) return null;
  return { sigmaLog, mu: -0.5 * sigmaLog * sigmaLog, sigmaPts: spot * sigmaLog };
}

/** P(S_T ≤ x) as a standard normal argument. */
function tailArg(model: LogModel, spot: number, x: number): number {
  return (Math.log(x / spot) - model.mu) / model.sigmaLog;
}

function tailProb(model: LogModel, spot: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return 1;
  return normalCdf(tailArg(model, spot, x));
}

/** E[S_T · 1{S_T ≤ x}] — needs the extra σ shift because S_T is lognormal. */
function partialFirstMoment(model: LogModel, spot: number, x: number): number {
  if (x <= 0) return 0;
  if (!Number.isFinite(x)) return spot;
  return spot * normalCdf(tailArg(model, spot, x) - model.sigmaLog);
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] === sorted[i - 1]) continue;
    out.push(sorted[i]);
  }
  return out;
}

/** Roots that sit on top of one another are one breakeven, not two. */
function pushRoot(roots: number[], value: number): void {
  if (!(value > 0) || !Number.isFinite(value)) return;
  for (let i = 0; i < roots.length; i++) {
    const tol = 1e-9 * Math.max(1, Math.abs(value));
    if (Math.abs(roots[i] - value) <= tol) return;
  }
  roots.push(value);
}

interface PayoffShape {
  breakevens: number[];
  /** Min / max over the kink set — the payoff is linear between kinks, so this is exact. */
  finiteMin: number;
  finiteMax: number;
  /** dPnL/dS as S → ∞, from the CE legs only. Non-zero ⇒ one bound is unbounded. */
  tailSlope: number;
  /** Kink partition `{0, strikes, past-the-last-strike}` used by the probability integral. */
  nodes: Float64Array;
}

/**
 * Payoff is piecewise-linear with kinks exactly at the strikes, so `{0, strikes,
 * past-the-last-strike}` fully determines it. Breakevens therefore come from
 * linear interpolation on those segments — never from the sampled chart curve,
 * which can straddle a narrow profitable band and miss it entirely.
 */
function analysePayoff(legs: readonly OptionLeg[], spot: number): PayoffShape {
  const strikes: number[] = [];
  let tailSlope = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    strikes.push(leg.strike);
    if (leg.type === "CE") tailSlope += legSign(leg) * legUnits(leg);
  }

  const ks = uniqueSorted(strikes);
  const lastK = ks.length > 0 ? ks[ks.length - 1] : spot;
  const firstK = ks.length > 0 ? ks[0] : spot;
  // The right sentinel must sit past every breakeven, not just past the last
  // strike: a bought call's root is `K + premium`, which can exceed `K` by a lot
  // on a far-dated contract.
  let maxPremium = 0;
  let maxStrike = 0;
  for (let i = 0; i < legs.length; i++) {
    if (Number.isFinite(legs[i].premium)) maxPremium = Math.max(maxPremium, Math.abs(legs[i].premium));
    if (Number.isFinite(legs[i].strike)) maxStrike = Math.max(maxStrike, Math.abs(legs[i].strike));
  }
  const span = Math.max(lastK - firstK, maxStrike, spot, maxPremium * 2, SENTINEL_SPAN);
  const rightEdge = Math.max(lastK, spot, maxStrike) + span;

  const kinks: number[] = [0, ...ks, rightEdge];
  const pnlAt = new Float64Array(kinks.length);
  const breakevens: number[] = [];
  let finiteMin = Number.POSITIVE_INFINITY;
  let finiteMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < kinks.length; i++) {
    const fHi = payoffAt(kinks[i], legs);
    pnlAt[i] = fHi;
    if (fHi < finiteMin) finiteMin = fHi;
    if (fHi > finiteMax) finiteMax = fHi;
    if (i === 0) continue;

    const lo = kinks[i - 1];
    const hi = kinks[i];
    const fLo = pnlAt[i - 1];
    if (fLo === 0 && fHi === 0) continue;
    if (fLo === 0) {
      pushRoot(breakevens, lo);
      continue;
    }
    if (fHi === 0) {
      pushRoot(breakevens, hi);
      continue;
    }
    // A flat zero segment above is folded in by the shared-root dedupe.
    if (fLo < 0 !== fHi < 0) pushRoot(breakevens, lo + ((hi - lo) * fLo) / (fLo - fHi));
  }

  breakevens.sort((a, b) => a - b);
  if (!Number.isFinite(finiteMin)) finiteMin = 0;
  if (!Number.isFinite(finiteMax)) finiteMax = 0;

  return { breakevens, finiteMin, finiteMax, tailSlope, nodes: Float64Array.from(kinks) };
}

/**
 * P&L of the basket at expiry for one spot. Allocation-free: the payoff panel
 * calls this 241× per recompute and the density panel once per cell.
 */
export function payoffAt(spot: number, legs: readonly OptionLeg[]): number {
  let pnl = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    pnl += legSign(leg) * legUnits(leg) * (intrinsic(spot, leg.strike, leg.type) - leg.premium);
  }
  return pnl;
}

/**
 * Payoff curve plus the analytic basket facts.
 *
 * `maxProfit` / `maxLoss` are `null` when that side is unbounded (a long call's
 * upside, a short call's downside) — the UI renders "∞", never a number that
 * came from truncating the chart window.
 */
export function payoffCurve(
  legs: readonly OptionLeg[],
  spot: number,
  opts: { widthPct?: number; points?: number } = {},
): PayoffResult {
  const netPremium = netPremiumOf(legs);
  if (!(spot > 0) || !Number.isFinite(spot)) {
    return { points: [], breakevens: [], maxProfit: null, maxLoss: null, netPremium };
  }

  const rawWidth = opts.widthPct ?? DEFAULT_WIDTH_PCT;
  const widthPct = Number.isFinite(rawWidth) ? Math.min(Math.max(rawWidth, 1e-6), 0.9) : DEFAULT_WIDTH_PCT;
  const rawPoints = opts.points ?? DEFAULT_POINTS;
  const n = Number.isFinite(rawPoints) ? Math.max(2, Math.floor(rawPoints)) : DEFAULT_POINTS;

  const shape = analysePayoff(legs, spot);
  const lo = spot * (1 - widthPct);
  const hi = spot * (1 + widthPct);
  const step = (hi - lo) / (n - 1);

  // Preallocated and mutated in place: the recompute path allocates once per call,
  // never once per sample.
  const points: PayoffPoint[] = Array.from({ length: n }, () => ({ spot: 0, pnl: 0 }));
  let min = shape.finiteMin;
  let max = shape.finiteMax;
  for (let i = 0; i < n; i++) {
    const s = lo + step * i;
    const pnl = payoffAt(s, legs);
    const point = points[i];
    point.spot = s;
    point.pnl = pnl;
    if (pnl < min) min = pnl;
    if (pnl > max) max = pnl;
  }

  return {
    points,
    breakevens: shape.breakevens,
    // tailSlope > 0 ⇒ profit grows without bound as S → ∞; < 0 ⇒ loss does.
    maxProfit: shape.tailSlope > 0 ? null : snapMoney(max),
    maxLoss: shape.tailSlope < 0 ? null : snapMoney(min),
    netPremium: snapMoney(netPremium),
  };
}

/**
 * Intrinsic arithmetic at the far sentinel strike (spot × 3 and up) leaves
 * sub-paisa float noise on an otherwise exact rupee bound; currency is not
 * meaningful below 1e-6, so the bound the UI prints is not 15 964.000000000015.
 */
function snapMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
}

/**
 * ±1σ in price points: S·σ·√T (same definition as `calculate_expected_move`).
 * `NaN` when the model inputs are missing — the strip renders "—". Returning 0
 * here would draw ±1σ bands pinned to spot, which reads as "no move priced".
 */
export function expectedMove(spot: number, iv: number, dteYears: number): number {
  const model = logModel(spot, iv, dteYears);
  return model ? model.sigmaPts : Number.NaN;
}

/**
 * POP and model expected P&L under a flat-vol lognormal (zero drift, r = 0).
 *
 * The integral is exact rather than sampled: within a cell the payoff is linear
 * (strikes and breakevens are inserted as nodes), so each cell contributes
 * `α·E[S_T·1{cell}] + β·P(cell)` in closed form. A midpoint/trapezoid rule over
 * a 241-node grid biases E[P&L] by half a cell step — enough to turn a
 * fair-value basket into a fake ₹500 edge.
 *
 * `density` is the plot series only (mass per bar; tails outside the window are
 * excluded from the bars but *not* from `pop`/`expectedPnl`). An unavailable
 * model returns `pop`/`expectedPnl`/`sigma` = NaN and an **empty** `density`;
 * consumers must render "—", never 0 % (plan §11.6).
 */
export function probabilityOfProfit(
  legs: readonly OptionLeg[],
  spot: number,
  iv: number,
  dteYears: number,
): { pop: number; expectedPnl: number; sigma: number; density: { spot: number; prob: number }[] } {
  const model = logModel(spot, iv, dteYears);
  if (!model) {
    return { pop: Number.NaN, expectedPnl: Number.NaN, sigma: Number.NaN, density: [] };
  }

  // The payoff window (±10 %) is the wrong window for a density: on a 2-day
  // contract ±10 % is ±10σ, so all the mass lands in one bar and the sparkline
  // is a single spike. Widen to at least ±3.5σ so the bell has a shape, and
  // keep the payoff window when it is already wider (far-dated, low vol).
  const densitySpan = Math.max(DEFAULT_WIDTH_PCT, (3.5 * model.sigmaPts) / spot);
  const dLo = spot * (1 - densitySpan);
  const dHi = spot * (1 + densitySpan);
  const dStep = (dHi - dLo) / (DEFAULT_POINTS - 1);

  const density: { spot: number; prob: number }[] = Array.from({ length: DEFAULT_POINTS }, () => ({
    spot: 0,
    prob: 0,
  }));
  for (let i = 0; i < DEFAULT_POINTS; i++) {
    const s = dLo + dStep * i;
    const bar = density[i];
    bar.spot = s;
    bar.prob = tailProb(model, spot, s + dStep / 2) - tailProb(model, spot, s - dStep / 2);
  }

  const shape = analysePayoff(legs, spot);
  // Kinks ∪ breakevens ∪ a regular grid: on every cell the payoff is linear AND
  // its sign is constant, so the closed-form cell integral is exact and no cell
  // is split across a profit boundary (omitting the breakevens understates POP).
  const nodes = uniqueSorted([
    ...Array.from(shape.nodes),
    ...shape.breakevens,
    ...gridNodes(dLo, dStep, DEFAULT_POINTS),
  ]);

  let pop = 0;
  let expectedPnl = 0;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const b = i === nodes.length - 1 ? Number.POSITIVE_INFINITY : nodes[i + 1];
    const mass = tailProb(model, spot, b) - tailProb(model, spot, a);
    const fA = payoffAt(a, legs);
    // Sign is constant on the cell, so one interior sample classifies the whole cell.
    const mid = b === Number.POSITIVE_INFINITY ? a + Math.max(a - nodes[i - 1], dStep) : (a + b) / 2;
    if (payoffAt(mid, legs) > 0) pop += mass;

    const slope = b === Number.POSITIVE_INFINITY ? shape.tailSlope : (payoffAt(b, legs) - fA) / (b - a);
    const intercept = fA - slope * a;
    const moment = partialFirstMoment(model, spot, b) - partialFirstMoment(model, spot, a);
    expectedPnl += slope * moment + intercept * mass;
  }

  return { pop, expectedPnl, sigma: model.sigmaPts, density };
}

function gridNodes(lo: number, step: number, count: number): number[] {
  const out = Array.from({ length: count }, () => 0);
  for (let i = 0; i < count; i++) out[i] = lo + step * i;
  return out;
}

/**
 * Net greeks. Scaling is `sign · lots · lotSize` per leg (delta comes back
 * shares-equivalent, theta in the feed's ₹/day, vega in ₹ per vol point).
 *
 * A missing greek on *any* leg nulls that aggregate and sets `partial` — zerofilling would
 * turn a delta-neutral basket into a directional one on paper (plan §5.4).
 */
export function aggregateGreeks(
  legs: readonly OptionLeg[],
  greeksByKey: (leg: OptionLeg) => {
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
  },
): { delta: number | null; gamma: number | null; theta: number | null; vega: number | null; partial: boolean } {
  let delta = 0;
  let gamma = 0;
  let theta = 0;
  let vega = 0;
  let deltaOk = true;
  let gammaOk = true;
  let thetaOk = true;
  let vegaOk = true;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const g = greeksByKey(leg);
    const scale = legSign(leg) * legUnits(leg);

    const d = g?.delta;
    if (typeof d === "number" && Number.isFinite(d)) delta += scale * d;
    else deltaOk = false;

    const gm = g?.gamma;
    if (typeof gm === "number" && Number.isFinite(gm)) gamma += scale * gm;
    else gammaOk = false;

    const th = g?.theta;
    if (typeof th === "number" && Number.isFinite(th)) theta += scale * th;
    else thetaOk = false;

    const v = g?.vega;
    if (typeof v === "number" && Number.isFinite(v)) vega += scale * v;
    else vegaOk = false;
  }

  const partial = !(deltaOk && gammaOk && thetaOk && vegaOk);
  return {
    delta: deltaOk ? delta : null,
    gamma: gammaOk ? gamma : null,
    theta: thetaOk ? theta : null,
    vega: vegaOk ? vega : null,
    partial,
  };
}

/**
 * Max pain: the strike with the smallest total payout to option holders at
 * expiry. Canonical writer convention (backend `api/options_levels._payouts`):
 * call OI at strikes BELOW the candidate pays `candidate - strike`, put OI at
 * strikes ABOVE it pays `strike - candidate`. OI of 0 is legal (an untraded
 * strike still is a candidate) and ties resolve to the lowest strike so the
 * result is deterministic.
 */
export function maxPain(chain: readonly { strike: number; ceOi: number; peOi: number }[]): number | null {
  let best: number | null = null;
  let bestPayout = Number.POSITIVE_INFINITY;

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i].strike;
    if (!Number.isFinite(candidate)) continue;

    let payout = 0;
    for (let j = 0; j < chain.length; j++) {
      const row = chain[j];
      if (!Number.isFinite(row.strike)) continue;
      const ceOi = Number.isFinite(row.ceOi) ? row.ceOi : 0;
      const peOi = Number.isFinite(row.peOi) ? row.peOi : 0;
      if (row.strike < candidate) payout += ceOi * (candidate - row.strike);
      else if (row.strike > candidate) payout += peOi * (row.strike - candidate);
    }

    if (payout < bestPayout) {
      bestPayout = payout;
      best = candidate;
    }
  }

  return best;
}

/** Put-call OI ratio. `null` when CE OI is 0 (0/0 must never render as 0.00). */
export function pcr(chain: readonly { ceOi: number; peOi: number }[]): number | null {
  let ce = 0;
  let pe = 0;
  for (let i = 0; i < chain.length; i++) {
    if (Number.isFinite(chain[i].ceOi)) ce += chain[i].ceOi;
    if (Number.isFinite(chain[i].peOi)) pe += chain[i].peOi;
  }
  if (!(ce > 0)) return null;
  const ratio = pe / ce;
  return Number.isFinite(ratio) ? ratio : null;
}

/**
 * Default expiry: the first listed date ≥ today, except that today's contract
 * stops being tradeable at the derivatives close (15:40 IST), after which the
 * next expiry wins — a dead chain with live-looking greeks is worse than one
 * more click. Today's date still stays in the list; the caller labels it
 * EXPIRED. Date comparison is date-only in IST because "today" is an exchange
 * concept, not a UTC one.
 */
export function pickDefaultExpiry(
  expiries: readonly string[],
  now: Date,
  derivativesCloseMinutes: number = DERIVATIVES_CLOSE_MIN,
): string | null {
  const today = istDateString(now);
  const cutoff = Number.isFinite(derivativesCloseMinutes) ? derivativesCloseMinutes : DERIVATIVES_CLOSE_MIN;
  const afterClose = istClock(now).minutes >= cutoff;

  const upcoming: string[] = [];
  for (let i = 0; i < expiries.length; i++) {
    const date = expiries[i];
    if (!isDateString(date) || date < today) continue;
    if (upcoming.indexOf(date) === -1) upcoming.push(date);
  }
  if (upcoming.length === 0) return null;
  upcoming.sort();

  if (upcoming[0] === today && afterClose) return upcoming.length > 1 ? upcoming[1] : null;
  return upcoming[0];
}

function isDateString(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function istDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
