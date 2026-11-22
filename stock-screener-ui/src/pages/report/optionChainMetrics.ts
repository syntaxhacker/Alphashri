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
 *   - `rowFlags` — ATM / call-wall / put-wall / ITM badges for one strike.
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
  label?: string;
}

export interface ChainSide {
  ltp?: number | null;
  /** Previous close, snake-case payload field. */
  close_price?: number | null;
  close?: number | null;
  oi?: number | null;
  prev_oi?: number | null;
  prevOi?: number | null;
  oi_change?: number | null;
  oiChange?: number | null;
  volume?: number | null;
  iv?: number | null;
  delta?: number | null;
  /** Chain endpoint sends `{label}`; the report model sends a plain string. */
  sentiment?: ChainSentiment | string | null;
}

export interface ChainRow {
  strike: number;
  ce: ChainSide;
  pe: ChainSide;
}

export interface ChainWalls {
  calls?: { strike: number }[] | null;
  puts?: { strike: number }[] | null;
}

interface LegChange {
  points: number;
  pct: number;
  label: string;
}

interface ChainRowFlags {
  atm: boolean;
  callWall: boolean;
  putWall: boolean;
  itmCe: boolean;
  itmPe: boolean;
}

const MINUS = "−";

import { safeNum } from "@/utils/reportParsers";

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closePrice(leg: ChainSide): number {
  return safeNum(leg.close_price ?? leg.close);
}

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
  const ltp = safeNum(leg.ltp);
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

function wallStrikes(walls: { strike: number }[] | null | undefined): Set<number> {
  const levels = new Set<number>();
  for (const wall of walls ?? []) {
    if (wall && Number.isFinite(wall.strike)) levels.add(wall.strike);
  }
  return levels;
}

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
