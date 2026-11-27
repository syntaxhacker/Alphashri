/**
 * Pure derivations behind the agri redesign visuals. Every value comes from a
 * payload field (or arithmetic on finite payload values); nothing is imputed
 * when an observation is missing.
 */
import type { AgriQuote, AgriSnapshot } from "@/types/agri";
import { seasonality } from "./agriEda";
import { quantile } from "./eda/shared";

export interface AgriAnalyticsSeries {
  key: string;
  label: string;
  points: ReadonlyArray<{ date: string; modal: number | null }>;
}

export interface AgriRankSeries {
  key: string;
  label: string;
  /** Chronological `YYYY-MM` buckets shared by the whole board. */
  months: string[];
  /** 1 = highest modal in that month; null = no finite observation. */
  ranks: Array<number | null>;
  modal: number | null;
  changePct: number | null;
}

export interface AgriSeasonCell {
  month: number;
  avg: number;
  /** Deviation from this commodity's own observed-month average, in %. */
  pct: number;
  years: number;
  count: number;
}

export interface AgriSeasonRow {
  key: string;
  label: string;
  cells: AgriSeasonCell[];
  /** Months above the row's own average / observed months. */
  hitRate: number | null;
  minYears: number | null;
}

export interface AgriDispersionRow {
  market: string;
  /** Shortened axis label; `market` stays intact for the tooltip. */
  label: string;
  date: string;
  min: number | null;
  modal: number | null;
  max: number | null;
  arrivals: number | null;
  outlier: boolean;
}

export interface AgriSparkRow {
  key: string;
  label: string;
  modal: number | null;
  change: number | null;
  points: number[];
}

export interface AgriDispersionSummary {
  /** Distinct mandis in the quote page. */
  markets: number;
  /** Mandis drawn in the panel. */
  shown: number;
  median: number | null;
  q1: number | null;
  q3: number | null;
  /** Fence used for the halos, over the same drawn rows as the stats. */
  fenceLow: number | null;
  fenceHigh: number | null;
  outliers: number;
}

export interface AgriDispersionPopulation {
  /** Drawn rows, ascending by modal, with the drawn-set halo flag applied. */
  rows: AgriDispersionRow[];
  summary: AgriDispersionSummary;
}

const MAX_SPARK_POINTS = 40;
const IQR_FENCE = 1.5;
const MAX_RANK_MONTHS = 24;

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function monthKey(date: unknown): string {
  return typeof date === "string" && /^\d{4}-(0[1-9]|1[0-2])/.test(date) ? date.slice(0, 7) : "";
}

function pointsOf(series: AgriAnalyticsSeries | null | undefined): Array<{ date: string; modal: number | null }> {
  return Array.isArray(series?.points) ? [...(series?.points ?? [])] : [];
}

/** One row per commodity key, first occurrence wins. */
function uniqueSeries(
  inputs: readonly AgriAnalyticsSeries[] | null | undefined,
): AgriAnalyticsSeries[] {
  const seen = new Set<string>();
  const rows: AgriAnalyticsSeries[] = [];
  for (const item of Array.isArray(inputs) ? inputs : []) {
    if (!item || typeof item.key !== "string" || seen.has(item.key)) continue;
    seen.add(item.key);
    rows.push(item);
  }
  return rows;
}

/**
 * Monthly price-rank board. Ranks are recomputed inside each month from the
 * commodities that actually have a finite modal that month, so a missing
 * observation is a broken line rather than a last-place rank.
 */
export function buildRankBoard(
  inputs: readonly AgriAnalyticsSeries[] | null | undefined,
): AgriRankSeries[] {
  const series = uniqueSeries(inputs);
  if (series.length === 0) return [];

  const byKey = new Map<string, Map<string, { sum: number; n: number }>>();
  const monthSet = new Set<string>();
  for (const item of series) {
    const buckets = new Map<string, { sum: number; n: number }>();
    for (const point of pointsOf(item)) {
      const key = monthKey(point?.date);
      const value = finite(point?.modal);
      if (!key || value == null) continue;
      const bucket = buckets.get(key) ?? { sum: 0, n: 0 };
      bucket.sum += value;
      bucket.n += 1;
      buckets.set(key, bucket);
      monthSet.add(key);
    }
    byKey.set(item.key, buckets);
  }

  const months = [...monthSet].sort().slice(-MAX_RANK_MONTHS);
  const ranks = new Map<string, Array<number | null>>();
  for (const item of series) {
    const buckets = byKey.get(item.key);
    ranks.set(
      item.key,
      months.map((month) => {
        const bucket = buckets?.get(month);
        return bucket && bucket.n > 0 ? bucket.sum / bucket.n : null;
      }),
    );
  }

  const rankRows = new Map<string, Array<number | null>>();
  for (const item of series) rankRows.set(item.key, months.map(() => null));
  months.forEach((_, monthIndex) => {
    const ranked = series
      .map((item) => ({ key: item.key, mean: ranks.get(item.key)?.[monthIndex] ?? null }))
      .filter((row): row is { key: string; mean: number } => row.mean != null)
      .sort((a, b) => b.mean - a.mean);
    // Equal means keep input order: a deterministic tiebreak beats flicker.
    ranked.forEach((row, index) => {
      (rankRows.get(row.key) as Array<number | null>)[monthIndex] = index + 1;
    });
  });

  return series.map((item) => {
    const values = ranks.get(item.key) ?? [];
    let first: number | null = null;
    let last: number | null = null;
    for (const value of values) {
      if (value == null) continue;
      if (first == null) first = value;
      last = value;
    }
    const changePct =
      first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;
    return {
      key: item.key,
      label: item.label || item.key,
      months,
      ranks: rankRows.get(item.key) ?? months.map(() => null),
      modal: last,
      changePct: finite(changePct),
    };
  });
}

/** Month-of-year deviation rows used by the commodity × month heatmap. */
export function buildSeasonRows(
  inputs: readonly AgriAnalyticsSeries[] | null | undefined,
): AgriSeasonRow[] {
  const series = uniqueSeries(inputs);
  const rows: AgriSeasonRow[] = [];
  for (const item of series) {
    const result = seasonality(
      pointsOf(item).map((point) => ({
        date: point.date,
        modal: point.modal,
        min: null,
        max: null,
        arrivals_qtl: null,
        market_count: 0,
      })),
    );
    if (result.months.length === 0) continue;
    const averages = result.months.map((month) => month.avg).filter((value) => finite(value) != null);
    const mean = averages.length > 0 ? averages.reduce((a, b) => a + b, 0) / averages.length : null;
    const cells: AgriSeasonCell[] = result.months.map((month) => ({
      month: month.month,
      avg: month.avg,
      pct: mean != null && mean > 0 ? ((month.avg - mean) / mean) * 100 : 0,
      years: month.years,
      count: month.count,
    }));
    rows.push({
      key: item.key,
      label: item.label || item.key,
      cells,
      hitRate: mean != null ? averages.filter((value) => value > mean).length / averages.length : null,
      minYears: Math.min(...result.months.map((month) => month.years)),
    });
  }
  return rows;
}

/** Axis-safe mandi name: drop committee suffixes and cap at 16 characters. */
export function shortMarketLabel(value: string): string {
  const raw = (typeof value === "string" ? value : "").trim();
  const stripped = raw
    .replace(/\bAPMC\b/gi, "")
    .replace(/\bMarket\b/gi, "")
    .replace(/\bMandi\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const text = stripped || raw;
  return text.length > 16 ? `${text.slice(0, 15).trimEnd()}…` : text;
}

/**
 * One row per mandi at the newest date present in the quote page. Duplicate
 * variety/grade rows for a market collapse to the last one; a 1.5×IQR fence
 * separates outliers instead of letting them flatten the whole range.
 */
export function buildDispersionRows(
  quotes: readonly AgriQuote[] | null | undefined,
): AgriDispersionRow[] {
  const rows = (Array.isArray(quotes) ? quotes : []).filter(
    (quote): quote is AgriQuote => !!quote && typeof quote?.market === "string",
  );
  if (rows.length === 0) return [];
  const latest = rows.reduce((max, row) => (row.date > max ? row.date : max), rows[0].date);
  const byMarket = new Map<string, AgriDispersionRow>();
  for (const quote of rows) {
    if (quote.date !== latest) continue;
    byMarket.set(quote.market, {
      market: quote.market,
      label: shortMarketLabel(quote.market),
      date: quote.date,
      min: finite(quote.min),
      modal: finite(quote.modal),
      max: finite(quote.max),
      arrivals: finite(quote.arrivals_qtl),
      outlier: false,
    });
  }
  const result = [...byMarket.values()];
  const modals = result
    .map((row) => row.modal)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  if (modals.length >= 4) {
    const q1 = quantile(modals, 0.25);
    const q3 = quantile(modals, 0.75);
    const iqr = q3 - q1;
    const low = q1 - IQR_FENCE * iqr;
    const high = q3 + IQR_FENCE * iqr;
    for (const row of result) {
      row.outlier = row.modal != null && (row.modal < low || row.modal > high);
    }
  }
  result.sort((a, b) => {
    if (a.modal == null) return b.modal == null ? a.market.localeCompare(b.market) : 1;
    if (b.modal == null) return -1;
    return a.modal - b.modal || a.market.localeCompare(b.market);
  });
  return result;
}

/** Population context for the dispersion panel: how many mandis exist and
 *  where the middle of the quote page sits, so "top 8 all outliers" is not
 *  mistaken for the whole mandi universe. */
export function selectDispersionPopulation(
  rows: readonly AgriDispersionRow[] | null | undefined,
  shown: number,
): AgriDispersionPopulation {
  const source = Array.isArray(rows) ? rows : [];
  // One population only: the stats and the halo fence both describe the
  // mandis the panel actually draws, never the full quote page.
  const drawCount = Math.max(0, Math.min(shown, source.length));
  const drawn = drawCount > 0 ? source.slice(source.length - drawCount) : [];
  const modals = drawn
    .map((row) => finite(row?.modal))
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const at = (p: number) => (modals.length > 0 ? quantile(modals, p) : null);
  const q1 = at(0.25);
  const q3 = at(0.75);
  let fenceLow: number | null = null;
  let fenceHigh: number | null = null;
  if (modals.length >= 4 && q1 != null && q3 != null) {
    const iqr = q3 - q1;
    fenceLow = q1 - IQR_FENCE * iqr;
    fenceHigh = q3 + IQR_FENCE * iqr;
  }
  const drawnRows = drawn.map((row) => ({
    ...row,
    outlier:
      row.modal != null &&
      fenceLow != null &&
      fenceHigh != null &&
      (row.modal < fenceLow || row.modal > fenceHigh),
  }));
  return {
    rows: drawnRows,
    summary: {
      markets: source.length,
      shown: drawCount,
      median: at(0.5),
      q1,
      q3,
      fenceLow,
      fenceHigh,
      outliers: drawnRows.filter((row) => row.outlier).length,
    },
  };
}

/** Back-compatible summary accessor (same population as the drawn rows). */
export function summariseDispersion(
  rows: readonly AgriDispersionRow[] | null | undefined,
  shown: number,
): AgriDispersionSummary {
  return selectDispersionPopulation(rows, shown).summary;
}

/**
 * Unified commodity universe: snapshot supplies the latest price/change for
 * every key, and the comparison payload supplies a real sparkline where that
 * key was requested. A key without a path renders a dash, never a drawn line.
 */
export function buildSparkRows(
  snapshot: readonly AgriSnapshot[] | null | undefined,
  comparison: readonly AgriAnalyticsSeries[] | null | undefined,
  labelFor: (key: string, fallback?: string) => string,
): AgriSparkRow[] {
  const byComparison = new Map<string, AgriAnalyticsSeries>();
  for (const item of Array.isArray(comparison) ? comparison : []) {
    if (item && typeof item.key === "string") byComparison.set(item.key, item);
  }
  const seen = new Set<string>();
  const rows: AgriSparkRow[] = [];
  const add = (
    key: string,
    label: string | null | undefined,
    snapshotRow: AgriSnapshot | null,
  ) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    const points = pointsOf(byComparison.get(key))
      .map((point) => finite(point.modal))
      .filter((value): value is number => value != null)
      .slice(-MAX_SPARK_POINTS);
    const last = points[points.length - 1] ?? null;
    const first = points[0] ?? null;
    const pathChange = first != null && last != null && first > 0 ? ((last - first) / first) * 100 : null;
    rows.push({
      key,
      label: label?.trim() || labelFor(key, key),
      modal: finite(snapshotRow?.modal) ?? last,
      change: finite(snapshotRow?.chg_1m_pct) ?? pathChange,
      points,
    });
  };

  for (const row of Array.isArray(snapshot) ? snapshot : []) {
    if (row && typeof row.key === "string") add(row.key, row.label, row);
  }
  for (const [key, item] of byComparison) add(key, item.label, null);

  rows.sort((a, b) => {
    if (a.modal == null) return b.modal == null ? a.label.localeCompare(b.label) : 1;
    if (b.modal == null) return -1;
    return b.modal - a.modal || a.label.localeCompare(b.label);
  });
  return rows;
}
