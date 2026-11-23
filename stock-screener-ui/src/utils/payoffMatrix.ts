/**
 * Pure strike × DTE payoff matrix for a multi-leg option structure.
 *
 * Row = strike (the hypothetical spot at that expiry), column = expiry. No
 * fetches, stores, timers or DOM — every input is supplied by the caller and
 * every output is a fresh, finite-only value.
 *
 * Two P&L views share one grid:
 *  - `intrinsic` is the expiry payoff, delegated to `payoffAt` so the matrix can
 *    never drift from the payoff chart.
 *  - `timeValue` is the *remaining extrinsic* value of the same structure if the
 *    spot were that row's strike with `T` years left to that column's expiry.
 *    It is `null` when IV is unavailable — never a fabricated number.
 *  - `pnl` is their sum: the mark-to-model P&L at that strike / DTE. At `T = 0`
 *    it collapses exactly onto `intrinsic`. With no IV it is the intrinsic alone
 *    and is still a real quote (`priced: true`, `basis: "intrinsic-only"`) — a
 *    missing IV is a data gap, not a price gap.
 *  - `priced` is false only when no finite P&L can be derived from the inputs at
 *    all (no usable spot, no legs, invalid strike); then `pnl` is `null`.
 *  - `basis` names which components make up `pnl` so the UI can label the cell.
 *
 * Time basis is a 365-day calendar year, matching `optionsMath`.
 */

import {
  payoffAt,
  payoffCurve,
  probabilityOfProfit,
  type OptionLeg,
} from "./optionsMath";

export interface MatrixLeg {
  action: "BUY" | "SELL";
  opt: "CE" | "PE";
  strike: number;
  premium: number;
  qty: number;
}

export interface PayoffMatrixInput {
  legs: MatrixLeg[];
  spot: number;
  /** ISO dates (YYYY-MM-DD), ascending. */
  expiries: string[];
  /** Explicit row grid; otherwise derived from legs + spot ± rangePct. */
  strikes?: number[];
  /** Default 0.08 (8 % each side of spot). */
  rangePct?: number;
  /** Decimal annual vol (0.31 = 31 %). null/absent ⇒ no time-value model. */
  iv?: number | null;
  /** Default 0.065 (flat RBI-repo-like rate, disclosed approximation). */
  rate?: number;
  /** ISO date used for T per expiry. Defaults to today's UTC calendar day. */
  asOf?: string;
}

/** Which components were summed into a cell's `pnl`. */
export type PayoffCellBasis = "intrinsic+time" | "intrinsic-only";

export interface PayoffMatrixCell {
  /**
   * Mark-to-model P&L: intrinsic + timeValue (intrinsic when IV unavailable).
   * Null only when the inputs genuinely cannot produce a finite number.
   */
  pnl: number | null;
  /** True whenever `pnl` is a finite number derived from spot + legs. */
  priced: boolean;
  /** Labels the composition of `pnl` (no IV ⇒ "intrinsic-only"). */
  basis: PayoffCellBasis;
  /** Expiry P&L from `payoffAt` at this row's strike. */
  intrinsic: number;
  /** Net extrinsic value of the structure at this strike/DTE; null without IV. */
  timeValue: number | null;
  /** Row strike as a percentage move from spot. */
  spotPct: number;
}

export interface PayoffMatrixKpis {
  /** Signed entry cost: +debit (buy), −credit (sell). */
  netDebit: number;
  /** null when the right tail is unbounded. */
  maxProfit: number | null;
  /** null when the left tail is unbounded. */
  maxLoss: number | null;
  breakevens: number[];
  /** POP at the nearest expiry; null when IV is unavailable. */
  pop: number | null;
}

export interface PayoffMatrix {
  strikes: number[];
  expiries: string[];
  /** cells[strikeIndex][expiryIndex]. */
  cells: PayoffMatrixCell[][];
  kpis: PayoffMatrixKpis;
  /** Row index nearest to spot, or null when there is no usable grid/spot. */
  spotRowIndex: number | null;
}

const DEFAULT_RANGE_PCT = 0.08;
const DEFAULT_RATE = 0.065;
const DAYS_PER_YEAR = 365;
const MAX_ROWS = 41;
/** Money is not meaningful below 1e-6 — also clears float noise at far sentinels. */
const SNAP = 1e6;

function snap(value: number): number {
  return Number.isFinite(value) ? Math.round(value * SNAP) / SNAP : 0;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * True only when a finite model time value exists — exactly 0 at expiry counts.
 * This answers "is there an extrinsic quote?", NOT "is the cell priced?": an IV
 * gap still has a finite intrinsic P&L, so use `cell.priced` for the latter.
 */
export function hasTimeValue(cell: { timeValue?: number | null } | null | undefined): boolean {
  return !!cell && typeof cell.timeValue === "number" && Number.isFinite(cell.timeValue);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return x;
}

/** A round tick when the legs carry no usable spacing (e.g. a single leg). */
function defaultTick(spot: number): number {
  if (!(spot > 0)) return 1;
  const raw = Math.max(1, spot * 0.0025);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return snap(nice * mag);
}

/** Exchange-like tick inferred as the GCD of sorted leg-strike gaps. */
export function inferTick(legStrikes: readonly number[], spot: number): number {
  if (legStrikes.length === 0) return defaultTick(spot);
  let g = 0;
  for (let i = 1; i < legStrikes.length; i++) {
    const d = legStrikes[i] - legStrikes[i - 1];
    if (!(d > 0) || !Number.isFinite(d)) continue;
    g = gcd(g === 0 ? Math.round(d * SNAP) : g, Math.round(d * SNAP));
  }
  const tick = g / SNAP;
  return tick > 0 && Number.isFinite(tick) ? tick : defaultTick(spot);
}

/** Uniformly thin an over-long explicit grid while keeping both endpoints. */
function capRows(values: number[]): number[] {
  if (values.length <= MAX_ROWS) return values;
  const out: number[] = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    out.push(values[Math.round((i * (values.length - 1)) / (MAX_ROWS - 1))]);
  }
  return out;
}

function sanitizeExplicitStrikes(values: unknown): number[] | null {
  if (!Array.isArray(values)) return null;
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    const value = snap(raw);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  out.sort((a, b) => a - b);
  return capRows(out);
}

/** Leg strikes ∪ spot ± rangePct, snapped to the tick and capped at 41 rows. */
function deriveStrikes(
  spot: number,
  legStrikes: readonly number[],
  rangePct: number,
  tick: number,
): number[] {
  const band = Math.min(Math.max(finite(rangePct, DEFAULT_RANGE_PCT), 1e-4), 1);
  const fallback = legStrikes.length > 0 ? legStrikes[Math.floor(legStrikes.length / 2)] : 0;
  const center = spot > 0 ? spot : fallback;
  if (!(center > 0)) return [];

  let lo = center * (1 - band);
  let hi = center * (1 + band);
  for (const k of legStrikes) {
    lo = Math.min(lo, k);
    hi = Math.max(hi, k);
  }
  if (!(hi > lo)) return [];

  let step = tick > 0 && Number.isFinite(tick) ? tick : 1;
  for (;;) {
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const count = Math.floor((end - start) / step + 1e-6) + 1;
    if (count <= MAX_ROWS) {
      const out: number[] = [];
      for (let i = 0; i < count && out.length < MAX_ROWS; i++) {
        const value = snap(start + i * step);
        if (value > 0 && out[out.length - 1] !== value) out.push(value);
      }
      return out;
    }
    step *= Math.ceil((count - 1) / (MAX_ROWS - 1));
    if (!Number.isFinite(step) || step <= 0) return [];
  }
}

export function parseIsoDate(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parts = value.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

function sanitizeExpiries(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (parseIsoDate(raw) == null || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out.sort();
}

function dteYears(asOf: string, expiry: string): number {
  const a = parseIsoDate(asOf);
  const e = parseIsoDate(expiry);
  if (a == null || e == null) return 0;
  return Math.max(0, (e - a) / (24 * 60 * 60 * 1000 * DAYS_PER_YEAR));
}

function nearestIndex(strikes: readonly number[], spot: number): number | null {
  if (strikes.length === 0 || !(spot > 0)) return null;
  let best = 0;
  let bestDistance = Math.abs(strikes[0] - spot);
  for (let i = 1; i < strikes.length; i++) {
    const distance = Math.abs(strikes[i] - spot);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Standard normal CDF — Abramowitz & Stegun 7.1.26, same as `optionsMath`. */
function normalCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = 0.3989422804014327 * Math.exp(-0.5 * ax * ax) * poly;
  return x >= 0 ? 1 - tail : tail;
}

/**
 * Black-76-ish value of one European option. "Ish": the forward is derived from
 * the scenario spot (`F = S·e^{rT}`) rather than inverted from a premium pair,
 * so no broker quote is needed. T ≤ 0 or σ ≤ 0 returns intrinsic exactly.
 */
function modelPrice(
  scenarioSpot: number,
  strike: number,
  t: number,
  sigma: number,
  rate: number,
  isCall: boolean,
): number {
  if (!(scenarioSpot > 0) || !(strike > 0)) return 0;
  const intrinsicNow = isCall
    ? Math.max(scenarioSpot - strike, 0)
    : Math.max(strike - scenarioSpot, 0);
  if (!(t > 0) || !(sigma > 0)) return intrinsicNow;

  const forward = scenarioSpot * Math.exp(rate * t);
  if (!(forward > 0) || !Number.isFinite(forward)) return intrinsicNow;
  const v = sigma * Math.sqrt(t);
  const d1 = (Math.log(forward / strike) + 0.5 * sigma * sigma * t) / v;
  const d2 = d1 - v;
  const disc = Math.exp(-rate * t);
  const price = isCall
    ? disc * (forward * normalCdf(d1) - strike * normalCdf(d2))
    : disc * (strike * normalCdf(-d2) - forward * normalCdf(-d1));
  return Number.isFinite(price) ? Math.max(0, price) : intrinsicNow;
}

/** Net extrinsic value of the structure at one cell, signed by leg side/qty. */
function netTimeValue(
  scenarioSpot: number,
  t: number,
  iv: number,
  rate: number,
  legs: readonly OptionLeg[],
): number {
  let total = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const sign = leg.side === "buy" ? 1 : -1;
    const units = leg.lotSize;
    const price = modelPrice(scenarioSpot, leg.strike, t, iv, rate, leg.type === "CE");
    const intrinsicNow =
      leg.type === "CE"
        ? Math.max(scenarioSpot - leg.strike, 0)
        : Math.max(leg.strike - scenarioSpot, 0);
    total += sign * units * (price - intrinsicNow);
  }
  return total;
}

function emptyMatrix(expiries: string[]): PayoffMatrix {
  return {
    strikes: [],
    expiries,
    cells: [],
    kpis: { netDebit: 0, maxProfit: null, maxLoss: null, breakevens: [], pop: null },
    spotRowIndex: null,
  };
}

export function buildPayoffMatrix(input: PayoffMatrixInput): PayoffMatrix {
  const expiries = sanitizeExpiries(input?.expiries);
  const sourceLegs = Array.isArray(input?.legs) ? input.legs : [];
  const pureLegs: OptionLeg[] = [];
  let netDebit = 0;

  for (let i = 0; i < sourceLegs.length; i++) {
    const raw = sourceLegs[i];
    if (!raw || typeof raw !== "object") continue;
    const side = raw.action === "BUY" ? "buy" : raw.action === "SELL" ? "sell" : null;
    const type = raw.opt === "CE" ? "CE" : raw.opt === "PE" ? "PE" : null;
    if (!side || !type || !(Number.isFinite(raw.strike) && raw.strike > 0)) continue;
    const qty = Math.max(0, finite(raw.qty, 0));
    if (qty === 0) continue;
    const premium = finite(raw.premium, 0);
    // lots × lotSize = qty, so payoffAt / payoffCurve scale every leg correctly.
    pureLegs.push({ side, type, strike: raw.strike, premium, lots: 1, lotSize: qty });
    netDebit += (side === "buy" ? 1 : -1) * premium * qty;
  }

  if (pureLegs.length === 0) return emptyMatrix(expiries);

  const spot = finite(input.spot, 0);
  const asOf = parseIsoDate(input.asOf) != null
    ? (input.asOf as string)
    : new Date().toISOString().slice(0, 10);
  const iv =
    typeof input.iv === "number" && Number.isFinite(input.iv) && input.iv > 0 ? input.iv : null;
  const rate = Number.isFinite(input.rate) ? (input.rate as number) : DEFAULT_RATE;

  const legStrikes = pureLegs.map((leg) => leg.strike).sort((a, b) => a - b);
  const strikes =
    sanitizeExplicitStrikes(input.strikes) ??
    deriveStrikes(spot, legStrikes, finite(input.rangePct, DEFAULT_RANGE_PCT), inferTick(legStrikes, spot));

  const referenceSpot = spot > 0 ? spot : legStrikes[0];
  const curve = payoffCurve(pureLegs, referenceSpot);
  const breakevens = curve.breakevens.filter(Number.isFinite).map(snap);
  const maxProfit = Number.isFinite(curve.maxProfit) ? snap(curve.maxProfit as number) : null;
  const maxLoss = Number.isFinite(curve.maxLoss) ? snap(curve.maxLoss as number) : null;

  let pop: number | null = null;
  if (iv != null && spot > 0 && expiries.length > 0) {
    const probability = probabilityOfProfit(pureLegs, spot, iv, dteYears(asOf, expiries[0]));
    if (Number.isFinite(probability.pop)) {
      pop = Math.min(1, Math.max(0, snap(probability.pop)));
    }
  }

  const cells = strikes.map((strike) =>
    expiries.map((expiry) => {
      const intrinsic = snap(payoffAt(strike, pureLegs));
      const rawTimeValue =
        iv == null ? null : netTimeValue(strike, dteYears(asOf, expiry), iv, rate, pureLegs);
      const timeValue =
        rawTimeValue != null && Number.isFinite(rawTimeValue) ? snap(rawTimeValue) : null;
      const rawPnl = intrinsic + (timeValue ?? 0);
      // A missing IV leaves intrinsic intact, so the cell is still a real quote.
      // Only an absent spot/legs or a non-finite sum makes it genuinely unpriced.
      const priced = spot > 0 && pureLegs.length > 0 && Number.isFinite(rawPnl);
      const basis: PayoffCellBasis = timeValue != null ? "intrinsic+time" : "intrinsic-only";
      return {
        pnl: priced ? snap(rawPnl) : null,
        priced,
        basis,
        intrinsic,
        timeValue,
        spotPct: spot > 0 ? snap(((strike - spot) / spot) * 100) : 0,
      };
    }),
  );

  return {
    strikes,
    expiries,
    cells,
    kpis: { netDebit: snap(netDebit), maxProfit, maxLoss, breakevens, pop },
    spotRowIndex: nearestIndex(strikes, spot),
  };
}

// ── Dense payoff table ──────────────────────────────────────────────────────
//
// A strike × dated-expiry grid in the tastytrade style. It owns only layout
// (which strikes, which dates); every P&L number is delegated to
// `buildPayoffMatrix` so the table can never disagree with the payoff chart.

export interface PayoffTableStrike {
  strike: number;
  spotPct: number;
  isAtm: boolean;
  tickLabel?: string;
}

export interface PayoffTableExpiry {
  date: string;
  label: string;
  dte: number;
  month: string;
  weekday: string;
}

export interface PayoffTableCell {
  pnl: number | null;
  priced: boolean;
  basis: PayoffCellBasis;
}

export interface PayoffTable {
  strikes: PayoffTableStrike[];
  expiries: PayoffTableExpiry[];
  /** cells[strikeIndex][expiryIndex]. */
  cells: PayoffTableCell[][];
  spot: number;
  kpis: PayoffMatrixKpis;
}

const DEFAULT_STRIKE_COUNT = 21;
const MIN_STRIKE_COUNT = 15;
const MAX_STRIKE_COUNT = 31;
const MAX_EXPIRIES = 20;
/** Near-term daily rungs, then weekly/monthly rungs out to ~3 months. */
const DEFAULT_DTE_STEPS = [0, 1, 2, 3, 4, 5, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(hi, Math.max(lo, Math.round(value)))
    : fallback;
}

function sanitizeDteSteps(values: unknown): number[] {
  if (!Array.isArray(values)) return DEFAULT_DTE_STEPS.slice();
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of values) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) continue;
    const dte = Math.round(raw);
    if (seen.has(dte)) continue;
    seen.add(dte);
    out.push(dte);
  }
  out.sort((a, b) => a - b);
  if (out.length === 0) return DEFAULT_DTE_STEPS.slice();
  if (out.length <= MAX_EXPIRIES) return out;
  const capped: number[] = [];
  for (let i = 0; i < MAX_EXPIRIES; i++) {
    capped.push(out[Math.round((i * (out.length - 1)) / (MAX_EXPIRIES - 1))]);
  }
  return [...new Set(capped)];
}

function addDaysIso(asOfIso: string, dte: number): string {
  const ms = parseIsoDate(asOfIso);
  return ms == null ? asOfIso : new Date(ms + dte * 86400000).toISOString().slice(0, 10);
}

function weekdayShort(iso: string): string {
  const ms = parseIsoDate(iso);
  return ms == null ? "" : WEEKDAYS[new Date(ms).getUTCDay()];
}

function monthShort(iso: string): string {
  const ms = parseIsoDate(iso);
  return ms == null ? "" : MONTHS[new Date(ms).getUTCMonth()];
}

/** Round an arbitrary raw step to a human-friendly 1/1.5/2/2.5/5/10 × 10ⁿ. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice =
    norm <= 1 ? 1 : norm <= 1.5 ? 1.5 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return snap(nice * mag);
}

/**
 * Dense-grid step: ~10 % of spot split across the rows, refined by a finer
 * leg-implied tick (so a NIFTY grid lands on 50-point rungs, not 250). The
 * upper bound keeps every strike positive when the centre is small.
 */
function tableStep(center: number, strikeCount: number, legTick: number): number {
  const base = center > 0 ? center : 1;
  const dense = niceStep((2 * base * 0.1) / Math.max(1, strikeCount - 1));
  const withLegTick = legTick > 0 && Number.isFinite(legTick) ? Math.min(dense, legTick) : dense;
  const mid = Math.floor(strikeCount / 2);
  const positiveBound = base / (mid + 1);
  const step = Math.min(withLegTick, positiveBound);
  return Number.isFinite(step) && step >= 1e-4 ? step : Math.max(base * 0.01, 1e-4);
}

function tableStrikes(
  center: number,
  spot: number,
  strikeCount: number,
  step: number,
): PayoffTableStrike[] {
  const mid = Math.floor(strikeCount / 2);
  const out: PayoffTableStrike[] = [];
  for (let i = 0; i < strikeCount; i++) {
    const raw = center + (i - mid) * step;
    const strike = snap(raw > 0 ? raw : center);
    out.push({
      strike,
      spotPct: spot > 0 ? snap(((strike - spot) / spot) * 100) : 0,
      isAtm: i === mid,
      tickLabel: String(Number(strike.toFixed(2))),
    });
  }
  return out;
}

export function buildPayoffTable(
  input: PayoffMatrixInput & { strikeCount?: number; dteSteps?: number[]; asOf?: string },
): PayoffTable {
  const sourceLegs = Array.isArray(input?.legs) ? input.legs : [];
  const legStrikes: number[] = [];
  for (const raw of sourceLegs) {
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.strike === "number" &&
      Number.isFinite(raw.strike) &&
      raw.strike > 0
    ) {
      legStrikes.push(raw.strike);
    }
  }
  legStrikes.sort((a, b) => a - b);

  const rawSpot = finite(input?.spot, 0);
  const center =
    rawSpot > 0 ? rawSpot : legStrikes.length > 0 ? legStrikes[Math.floor(legStrikes.length / 2)] : 1;
  const strikeCount = clampInt(
    input?.strikeCount,
    DEFAULT_STRIKE_COUNT,
    MIN_STRIKE_COUNT,
    MAX_STRIKE_COUNT,
  );

  // An explicit grid is used verbatim; the dense rung grid is the fallback.
  // Both paths hand the row strike to buildPayoffMatrix, which evaluates the
  // intrinsic at that strike — never at the underlying spot.
  const explicit = sanitizeExplicitStrikes(input?.strikes);
  const step = tableStep(center, strikeCount, inferTick(legStrikes, center));
  const generated = explicit && explicit.length > 0 ? null : tableStrikes(center, rawSpot, strikeCount, step);
  const strikeValues = generated ? generated.map((s) => s.strike) : explicit!;
  const atmIndex = nearestIndex(strikeValues, rawSpot);
  const strikes: PayoffTableStrike[] = generated ?? strikeValues.map((strike, i) => ({
    strike,
    spotPct: rawSpot > 0 ? snap(((strike - rawSpot) / rawSpot) * 100) : 0,
    isAtm: i === atmIndex,
    tickLabel: String(Number(strike.toFixed(2))),
  }));

  const asOf = parseIsoDate(input?.asOf) != null
    ? (input.asOf as string)
    : new Date().toISOString().slice(0, 10);
  const expiries: PayoffTableExpiry[] = sanitizeDteSteps(input?.dteSteps).map((dte) => {
    const date = addDaysIso(asOf, dte);
    const ms = parseIsoDate(date);
    return {
      date,
      label: `${ms == null ? 0 : new Date(ms).getUTCDate()} ${weekdayShort(date)}`,
      dte,
      month: `${monthShort(date)} ${date.slice(0, 4)}`,
      weekday: weekdayShort(date),
    };
  });

  const matrix = buildPayoffMatrix({
    ...input,
    spot: rawSpot,
    asOf,
    expiries: expiries.map((e) => e.date),
    strikes: strikes.map((s) => s.strike),
  });

  // Bind each cell to its own row strike by value, not by position: if the
  // matrix filtered or reordered the grid, positional indexing would silently
  // paint every row with the same (wrong) payoff.
  const matrixRowByStrike = new Map(matrix.strikes.map((strike, row) => [strike, row]));
  const cells: PayoffTableCell[][] = strikes.map((entry, r) =>
    expiries.map((__, col) => {
      const matrixRow = matrixRowByStrike.get(entry.strike) ?? r;
      const cell = matrix.cells[matrixRow]?.[col];
      const priced = !!cell && cell.priced && Number.isFinite(cell.pnl);
      return {
        pnl: priced ? cell!.pnl : null,
        priced,
        basis: cell?.basis ?? "intrinsic-only",
      };
    }),
  );

  return {
    strikes,
    expiries,
    cells,
    spot: snap(rawSpot > 0 ? rawSpot : 0),
    kpis: { ...matrix.kpis },
  };
}
