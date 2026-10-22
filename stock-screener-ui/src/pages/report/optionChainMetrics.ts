/**
 * Option-chain table metrics.
 *
 * Pure, clock-free helpers for the live option chain rendered in the report.
 * Nothing here fetches or formats JSX — the table component stays responsible
 * for layout, and these functions own the arithmetic so it can be pinned by
 * tests:
 *
 *   - `formatLegChange` — premium change in points *and* percent. The table
 *     header used to say "Chg%" while showing points; both values now travel
 *     together in one label so a header/cell mismatch cannot come back.
 *   - `oiChangePct` — today's OI build as a percentage of yesterday's OI.
 *   - `rowFlags` — ATM / call-wall / put-wall / ITM badges for one strike.
 *   - `sortChainRows` — stable ordering by strike, OI, volume or ΔOI.
 *   - `chainSummary` — CE/PE writer-vs-buyer totals, mirroring the desk's
 *     "CE writers +86.9M vs PE buyers +35.2M" read.
 *
 * Payloads are the live `/api/options/*` chain rows (`close_price`, `prev_oi`,
 * `oi_change`, `sentiment: {label}`). The camel-case aliases from the Nifty
 * report model (`close`, `prevOi`, `oiChange`) are accepted as fallbacks so
 * either shape can be wired without an adapter. Missing or non-finite values
 * are treated as `0` (or `null` where a percentage is meaningless) — none of
 * these helpers throw.
 */

/** Option sentiment block emitted by the chain endpoint. */
interface ChainSentiment {
  type?: string;
  color?: string;
  /** `LB` (long buildup), `SB` (short buildup), `SC`, `LU` or `Neutral`. */
  label?: string;
}

/** One leg (CE or PE) of a chain row. */
export interface ChainSide {
  ltp?: number | null;
  /** Previous close, snake-case payload field. */
  close_price?: number | null;
  /** Camel-case alias (`NiftyOptionSide.close`). */
  close?: number | null;
  oi?: number | null;
  prev_oi?: number | null;
  /** Camel-case alias (`NiftyOptionSide.prevOi`). */
  prevOi?: number | null;
  oi_change?: number | null;
  /** Camel-case alias (`NiftyOptionSide.oiChange`). */
  oiChange?: number | null;
  volume?: number | null;
  iv?: number | null;
  delta?: number | null;
  /** Chain endpoint sends `{label}`; the report model sends a plain string. */
  sentiment?: ChainSentiment | string | null;
}

/** One strike row of the option chain. */
export interface ChainRow {
  strike: number;
  ce: ChainSide;
  pe: ChainSide;
}

/** Top OI walls — the arrays are already the desk's chosen wall strikes. */
export interface ChainWalls {
  calls?: { strike: number }[] | null;
  puts?: { strike: number }[] | null;
}

interface LegChange {
  /** `ltp - close_price`, in index/option points. */
  points: number;
  /** Premium change as a percent of the previous close (`0` when close ≤ 0). */
  pct: number;
  /** Display string, e.g. `−108.55 (−4.2%)`. */
  label: string;
}

type ChainSortKey = "strike" | "oi" | "volume" | "oiChange";

interface ChainRowFlags {
  atm: boolean;
  callWall: boolean;
  putWall: boolean;
  itmCe: boolean;
  itmPe: boolean;
}

export interface ChainSummary {
  ceWriters: number;
  ceBuyers: number;
  peWriters: number;
  peBuyers: number;
  /** Signed Σ CE ΔOI (writers positive, unwinding negative). */
  netCe: number;
  /** Signed Σ PE ΔOI. */
  netPe: number;
}

/** U+2212 minus — matches the report's tabular number style. */
const MINUS = "−";

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function num(value: number | null | undefined): number {
  return finiteOrNull(value) ?? 0;
}

function closePrice(leg: ChainSide): number {
  return num(leg.close_price ?? leg.close);
}

function oiChange(leg: ChainSide): number {
  return num(leg.oi_change ?? leg.oiChange);
}

function oi(leg: ChainSide): number {
  return num(leg.oi);
}

function volume(leg: ChainSide): number {
  return num(leg.volume);
}

/** Signed, fixed-decimal display — avoids `−0.00` on tiny negatives. */
function signed(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  const body = Math.abs(rounded).toFixed(decimals);
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `${MINUS}${body}`;
  return body;
}

/**
 * Premium change vs the previous close.
 *
 * `pct` is `0` when `close_price` is missing/non-positive (a percentage of
 * zero is not meaningful, but the points move is still real and is reported).
 */
export function formatLegChange(leg: ChainSide): LegChange {
  const ltp = num(leg.ltp);
  const close = closePrice(leg);
  const points = ltp - close;
  const pct = close > 0 ? (points / close) * 100 : 0;
  return {
    points,
    pct,
    // A percentage of a non-positive previous close is meaningless: keep the
    // real points move but print a dash instead of a fabricated 0.0%.
    label: `${signed(points, 2)} (${close > 0 ? `${signed(pct, 1)}%` : "—%"})`,
  };
}

/**
 * Today's OI build as a percent of yesterday's OI:
 * `oi_change / max(oi - oi_change, 1) * 100`.
 *
 * Returns `null` when `oi` or `oi_change` is absent/non-finite. A zero
 * `oi_change` is a real value (flat day), not a missing one.
 */
export function oiChangePct(leg: ChainSide): number | null {
  const change = finiteOrNull(leg.oi_change ?? leg.oiChange);
  const total = finiteOrNull(leg.oi);
  if (change === null || total === null) return null;
  const base = Math.max(total - change, 1);
  return (change / base) * 100;
}

function wallStrikes(walls: { strike: number }[] | null | undefined): Set<number> {
  const levels = new Set<number>();
  for (const wall of walls ?? []) {
    if (wall && Number.isFinite(wall.strike)) levels.add(wall.strike);
  }
  return levels;
}

/**
 * Badge flags for one strike.
 *
 * ATM is the strike within half a step of spot (default step 50 → ±25). An ITM
 * call sits below spot, an ITM put above; the exact ATM strike is neither.
 * Wall flags come from the supplied top-wall strikes.
 */
export function rowFlags(
  row: ChainRow,
  spot: number,
  walls: ChainWalls = {},
  atmStep = 50,
): ChainRowFlags {
  const strike = finiteOrNull(row.strike);
  const spotValue = finiteOrNull(spot);
  const callWalls = wallStrikes(walls.calls);
  const putWalls = wallStrikes(walls.puts);

  const atm =
    strike !== null &&
    spotValue !== null &&
    Math.abs(strike - spotValue) < atmStep / 2;
  const itmCe = strike !== null && spotValue !== null && strike < spotValue;
  const itmPe = strike !== null && spotValue !== null && strike > spotValue;

  return {
    atm,
    callWall: strike !== null && callWalls.has(strike),
    putWall: strike !== null && putWalls.has(strike),
    itmCe,
    itmPe,
  };
}

/** Row-level sort metric: both legs summed, so sorting is side-symmetric. */
function sortValue(row: ChainRow, by: ChainSortKey): number {
  switch (by) {
    case "strike":
      return num(row.strike);
    case "oi":
      return oi(row.ce) + oi(row.pe);
    case "volume":
      return volume(row.ce) + volume(row.pe);
    case "oiChange":
      return oiChange(row.ce) + oiChange(row.pe);
  }
}

/**
 * Stable chain ordering — ascending strike, descending OI/volume/ΔOI. Equal
 * values keep their incoming order. Returns a new array; the input is never
 * mutated.
 */
export function sortChainRows(rows: ChainRow[], by: ChainSortKey): ChainRow[] {
  const direction = by === "strike" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, by) }))
    .sort((a, b) => {
      if (a.value !== b.value) return (a.value - b.value) * direction;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

function finish(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sentimentLabel(leg: ChainSide): string {
  const sentiment = leg.sentiment;
  const raw =
    typeof sentiment === "string" ? sentiment : sentiment?.label ?? "";
  return raw.trim().toUpperCase();
}

/**
 * Writer/buyer totals across the chain.
 *
 * Sentiment labels are bucketed exactly as the desk reads them: `SB` (short
 * buildup) is a writer, `LB` (long buildup) is a buyer. Other/absent labels
 * do not contribute, but every leg's ΔOI is still counted in `netCe`/`netPe`.
 */
export function chainSummary(rows: ChainRow[]): ChainSummary {
  let ceWriters = 0;
  let ceBuyers = 0;
  let peWriters = 0;
  let peBuyers = 0;
  let netCe = 0;
  let netPe = 0;

  for (const row of rows) {
    const ceChange = oiChange(row.ce);
    const peChange = oiChange(row.pe);
    netCe += ceChange;
    netPe += peChange;

    const ceLabel = sentimentLabel(row.ce);
    if (ceLabel === "SB") ceWriters += ceChange;
    else if (ceLabel === "LB") ceBuyers += ceChange;

    const peLabel = sentimentLabel(row.pe);
    if (peLabel === "SB") peWriters += peChange;
    else if (peLabel === "LB") peBuyers += peChange;
  }

  return {
    ceWriters: finish(ceWriters),
    ceBuyers: finish(ceBuyers),
    peWriters: finish(peWriters),
    peBuyers: finish(peBuyers),
    netCe: finish(netCe),
    netPe: finish(netPe),
  };
}
