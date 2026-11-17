/**
 * Pure readers that turn the analytics payload into chart-ready series.
 *
 * Missing is missing: a leg without greeks or a block that was never fetched
 * yields an empty array (and the panel shows a reason), never a zero-filled
 * series that would read as a real data point. Every reader tolerates a partial
 * or `undefined` block so a panel never throws on a half-populated payload.
 */

import type {
  AnalyticsExpiry,
  AnalyticsIvPoint,
  AnalyticsLevels,
} from "@/api/optionsAnalytics";
import { termPoints } from "@/utils/optionsAnalyticsMath";
import type {
  DashboardAnalytics,
  SpreadCell,
  StrikePair,
  StrikeValue,
  TenorValue,
} from "./types";

const arr = <T,>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const finitePositive = (value: unknown): value is number => finite(value) && value > 0;

/** Fields the dashboard client adds beyond the base analytics DTO. */
interface ExtraExpiry {
  rnd?: { density?: Array<{ spot: number | null; prob: number | null }> } | null;
  dealer?: {
    netGex?: number | null;
    gammaFlip?: number | null;
    regime?: string | null;
    support?: number | null;
    resistance?: number | null;
  } | null;
  liquidity?: {
    avgSpreadPct?: number | null;
    liquidStrikes?: number | null;
    thin?: boolean | null;
    totalOi?: number | null;
    totalVolume?: number | null;
  } | null;
}
interface ExtraData {
  rv?: {
    current?: number | null;
    rv5?: number | null;
    rv10?: number | null;
    rv20?: number | null;
    rv30?: number | null;
  } | null;
}
const extraData = (data: unknown): ExtraData => (data ?? {}) as ExtraData;
const extraExpiry = (expiry: unknown): ExtraExpiry => (expiry ?? {}) as ExtraExpiry;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface ExpiryOption {
  date: string;
  dte: number | null;
  label: string;
}

/** Short, locale-free label: `26 NOV · 10d`. Safe on a malformed date. */
export function expiryLabel(date: string | null | undefined, dte: number | null | undefined): string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "—";
  const [, month, day] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  const base = `${Number(day)} ${name}`;
  return finite(dte) ? `${base} · ${dte}d` : base;
}

export function expiryOptions(data: DashboardAnalytics | null | undefined): ExpiryOption[] {
  return arr(data?.expiries)
    .filter((expiry): expiry is AnalyticsExpiry => typeof expiry?.date === "string" && expiry.date.length > 0)
    .map((expiry) => ({
      date: expiry.date,
      dte: expiry.dte ?? null,
      label: expiryLabel(expiry.date, expiry.dte),
    }));
}

export function expiryFor(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry: string | null | undefined,
): AnalyticsExpiry | null {
  const list = arr(data?.expiries);
  if (!list.length) return null;
  return list.find((expiry) => expiry?.date === selectedExpiry) ?? list[0] ?? null;
}

/**
 * One OI reading per strike. A point's delta sign identifies the side (CE > 0,
 * PE < 0); when the greek is missing we fall back to strike vs spot. Legs of the
 * same strike and side accumulate rather than overwrite.
 */
export function oiByStrike(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry: string | null | undefined,
): StrikePair[] {
  const expiry = expiryFor(data, selectedExpiry);
  const spot = data?.spot;
  const byStrike = new Map<number, StrikePair>();

  for (const point of arr(expiry?.points) as AnalyticsIvPoint[]) {
    const strike = point?.strike;
    const oi = point?.oi;
    if (!finitePositive(strike) || !finite(oi)) continue;
    const side = finite(point.delta)
      ? point.delta > 0 ? "ce" : "pe"
      : finitePositive(spot) ? (strike >= (spot as number) ? "ce" : "pe") : null;
    if (!side) continue;
    const row = byStrike.get(strike) ?? { strike, ce: null, pe: null };
    row[side] = (row[side] ?? 0) + oi;
    byStrike.set(strike, row);
  }

  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

/** Total payout at expiry for every strike in the ladder (max pain is its min). */
export function payoutCurve(pairs: StrikePair[]): StrikeValue[] {
  return pairs.map((row) => {
    let payout = 0;
    for (const leg of pairs) {
      if (leg.strike < row.strike) payout += (leg.pe ?? 0) * (row.strike - leg.strike);
      else if (leg.strike > row.strike) payout += (leg.ce ?? 0) * (leg.strike - row.strike);
    }
    return { strike: row.strike, value: payout };
  });
}

export function maxPainStrike(curve: StrikeValue[]): number | null {
  if (!curve.length) return null;
  return curve.reduce((best, row) =>
    finite(row.value) && row.value < (best.value ?? Number.POSITIVE_INFINITY) ? row : best,
  ).strike;
}

/** Cumulative PE OI / CE OI as the strike ladder advances. */
export function pcrByStrike(pairs: StrikePair[]): StrikeValue[] {
  let ce = 0;
  let pe = 0;
  return pairs.map((row) => {
    ce += row.ce ?? 0;
    pe += row.pe ?? 0;
    return { strike: row.strike, value: ce > 0 ? pe / ce : null };
  });
}

export interface SmileSeries {
  ce: Array<[number, number]>;
  pe: Array<[number, number]>;
}

export function smileSeries(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry: string | null | undefined,
): SmileSeries {
  const expiry = expiryFor(data, selectedExpiry);
  const spot = data?.spot;
  const out: SmileSeries = { ce: [], pe: [] };

  for (const point of arr(expiry?.points) as AnalyticsIvPoint[]) {
    if (!finitePositive(point?.strike) || !finitePositive(point.iv)) continue;
    const side = finite(point.delta)
      ? point.delta > 0 ? "ce" : "pe"
      : finitePositive(spot) ? (point.strike >= (spot as number) ? "ce" : "pe") : null;
    if (!side) continue;
    out[side].push([point.strike, point.iv]);
  }
  out.ce.sort((a, b) => a[0] - b[0]);
  out.pe.sort((a, b) => a[0] - b[0]);
  return out;
}

export function densitySeries(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry?: string | null,
): Array<[number, number]> {
  const parse = (points: Array<{ spot: number | null; prob: number | null }> | undefined) =>
    arr(points)
      .filter((point) => finitePositive(point?.spot) && finite(point?.prob))
      .map((point) => [point.spot as number, point.prob as number] as [number, number])
      .sort((a, b) => a[0] - b[0]);
  const own = parse(data?.probability?.density);
  if (own.length >= 2) return own;
  // The dashboard client carries a per-expiry fitted RND; the shipped dock DTO
  // only has a top-level probability density. Prefer whichever is populated.
  return parse(extraExpiry(expiryFor(data, selectedExpiry)).rnd?.density);
}

export function rvSeries(data: DashboardAnalytics | null | undefined): TenorValue[] {
  const own = arr(data?.realisedVol)
    .filter((point) => finite(point?.dte) && finite(point?.value))
    .map((point) => ({ dte: point.dte as number, value: point.value as number }));
  if (own.length) return own.sort((a, b) => a.dte - b.dte);

  // Dashboard DTO: a realised-vol term as rv5 / rv10 / rv20 / rv30 scalars.
  const rv = extraData(data).rv;
  const term: Array<[number, number | null | undefined]> = [
    [5, rv?.rv5],
    [10, rv?.rv10],
    [20, rv?.rv20],
    [30, rv?.rv30],
  ];
  return term
    .filter((row): row is [number, number] => finite(row[1]))
    .map(([dte, value]) => ({ dte, value }));
}

/** Per-expiry dealer / liquidity aggregates (the dashboard DTO shape). */
export function dealerAggregate(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry: string | null | undefined,
): ExtraExpiry["dealer"] {
  return extraExpiry(expiryFor(data, selectedExpiry)).dealer ?? null;
}

export function liquidityAggregate(
  data: DashboardAnalytics | null | undefined,
  selectedExpiry: string | null | undefined,
): ExtraExpiry["liquidity"] {
  return extraExpiry(expiryFor(data, selectedExpiry)).liquidity ?? null;
}

/** Term IV is always available from the shipped DTO, RV is not. */
export function currentIvSeries(data: DashboardAnalytics | null | undefined): Array<[number, number]> {
  if (!data) return [];
  return termPoints(data, "atm").map((point) => [point.dte, point.iv]);
}

type DealerKey = "gex" | "dex" | "vanna" | "charm";

export function dealerSeries(
  data: DashboardAnalytics | null | undefined,
  key: DealerKey,
): StrikeValue[] {
  return arr(data?.dealer?.[key])
    .filter((point) => finite(point?.strike) && finite(point?.value))
    .map((point) => ({ strike: point.strike as number, value: point.value as number }))
    .sort((a, b) => a.strike - b.strike);
}

export function thetaSeries(data: DashboardAnalytics | null | undefined): TenorValue[] {
  return arr(data?.dealer?.theta)
    .filter((point) => finite(point?.dte) && finite(point?.value))
    .map((point) => ({ dte: point.dte as number, value: point.value as number }))
    .sort((a, b) => a.dte - b.dte);
}

export function spreadCells(data: DashboardAnalytics | null | undefined): SpreadCell[] {
  return arr(data?.liquidity?.spread).filter(
    (cell): cell is SpreadCell =>
      typeof cell?.strike === "number" &&
      Number.isFinite(cell.strike) &&
      typeof cell.expiry === "string" &&
      (cell.spread == null || Number.isFinite(cell.spread)),
  );
}

export function volOiSeries(data: DashboardAnalytics | null | undefined): StrikeValue[] {
  return arr(data?.liquidity?.volumeOi)
    .filter((point) => finite(point?.strike) && finite(point?.value))
    .map((point) => ({ strike: point.strike as number, value: point.value as number }))
    .sort((a, b) => a.strike - b.strike);
}

export interface LiquidityStats {
  median: number | null;
  unquoted: number;
  total: number;
}

export function liquidityStats(cells: SpreadCell[]): LiquidityStats {
  const quoted = cells
    .map((cell) => cell.spread)
    .filter((value): value is number => finite(value))
    .sort((a, b) => a - b);
  const mid = Math.floor(quoted.length / 2);
  const median = quoted.length
    ? Number((quoted.length % 2 ? quoted[mid] : (quoted[mid - 1] + quoted[mid]) / 2).toFixed(4))
    : null;
  return { median, unquoted: cells.length - quoted.length, total: cells.length };
}

export interface WallMark {
  strike: number;
  label: string;
}

export function wallMarks(levels: AnalyticsLevels | null | undefined): WallMark[] {
  if (!levels) return [];
  const candidates: Array<[number | null | undefined, string]> = [
    [levels.callWall, "CW"],
    [levels.putWall, "PW"],
    [levels.maxPain, "MP"],
    [levels.gex?.support, "SUP"],
    [levels.gex?.resistance, "RES"],
  ];
  return candidates
    .filter((row): row is [number, string] => finitePositive(row[0]))
    .map(([strike, label]) => ({ strike, label }));
}
