/**
 * Market breadth derived from the snapshot already loaded by the screener.
 * The retired daily report used a second endpoint; these numbers are computed
 * from the same `MarketRow[]` the table reads, with the report's semantics.
 */
import type { MarketRow } from "../../types/marketScreener";

/** Below this share of usable rows a derived stat is hidden instead of shown as 0. */
export const BREADTH_MIN_COVERAGE = 0.8;

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export interface BreadthFieldCoverage {
  /** Rows on which the field (or an equivalent substitute) is usable. */
  covered: number;
  total: number;
  ratio: number;
  reliable: boolean;
}

const coverageOf = (covered: number, total: number): BreadthFieldCoverage => {
  const ratio = total > 0 ? covered / total : 0;
  return {
    covered,
    total,
    ratio,
    reliable: total > 0 && ratio >= BREADTH_MIN_COVERAGE,
  };
};

export interface MarketBreadth {
  /** Rows actually counted — ETFs are excluded by default. */
  total: number;
  /** Length of the full snapshot, before the ETF exclusion. */
  loadedRows: number;
  etfsExcluded: number;
  advances: number | null;
  declines: number | null;
  /** Snapshot rows with no signed move (including a null change) — report parity. */
  unchanged: number | null;
  changeCoverage: BreadthFieldCoverage;
  /** `null` means "not enough 52W data", never "no new highs". */
  newHighs: number | null;
  newLows: number | null;
  high52Coverage: BreadthFieldCoverage;
  low52Coverage: BreadthFieldCoverage;
  avgChange: number | null;
  medianChange: number | null;
  /** Row COUNTS with a strong up/down move, not summed share volume. */
  upVolumeCount: number | null;
  downVolumeCount: number | null;
  volumeCoverage: BreadthFieldCoverage;
}

export interface ComputeMarketBreadthOptions {
  /** Breadth describes the stock market; ETFs are opt-in. */
  includeEtfs?: boolean;
}

const round4 = (value: number): number => {
  const rounded = Math.round(value * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * One pass over the snapshot. Every field that can be absent carries its own
 * coverage, so the UI can show a dash rather than a confident-looking zero.
 */
export function computeMarketBreadth(
  rows: readonly MarketRow[],
  options: ComputeMarketBreadthOptions = {},
): MarketBreadth {
  const includeEtfs = options.includeEtfs === true;
  const eligible = includeEtfs ? [...rows] : rows.filter((row) => !row.etf);
  const total = eligible.length;

  let changeCovered = 0;
  let advances = 0;
  let declines = 0;
  const changes: number[] = [];

  let high52Covered = 0;
  let low52Covered = 0;
  let newHighs = 0;
  let newLows = 0;

  let volumeCovered = 0;
  let upVolumeCount = 0;
  let downVolumeCount = 0;

  for (const row of eligible) {
    const change = finite(row.change) ? row.change : null;
    if (change !== null) {
      changeCovered++;
      changes.push(change);
      if (change > 0) advances++;
      else if (change < 0) declines++;
    }

    // Either the raw levels or the server's signed percentages can prove a 52W
    // touch. `>= 0` on the signed gap means at/above the high (resp. low).
    const rawHigh = finite(row.close) && finite(row.high52w) && row.high52w > 0;
    const rawLow = finite(row.close) && finite(row.low52w) && row.low52w > 0;
    if (rawHigh || finite(row.to52wHighPct)) {
      high52Covered++;
      if ((rawHigh && row.close! >= row.high52w!) || (finite(row.to52wHighPct) && row.to52wHighPct >= 0)) {
        newHighs++;
      }
    }
    if (rawLow || finite(row.from52wLowPct)) {
      low52Covered++;
      if ((rawLow && row.close! <= row.low52w!) || (finite(row.from52wLowPct) && row.from52wLowPct <= 0)) {
        newLows++;
      }
    }

    if (finite(row.volume) && finite(row.avgVolume)) {
      volumeCovered++;
      // Retired report's "up volume"/"down volume": a COUNT of names whose
      // signed move is strong and whose volume is at least the trailing average.
      if (change !== null && row.volume >= row.avgVolume!) {
        if (change > 0) upVolumeCount++;
        else if (change < 0) downVolumeCount++;
      }
    }
  }

  const changeCoverage = coverageOf(changeCovered, total);
  const high52Coverage = coverageOf(high52Covered, total);
  const low52Coverage = coverageOf(low52Covered, total);
  const volumeCoverage = coverageOf(volumeCovered, total);

  return {
    total,
    loadedRows: rows.length,
    etfsExcluded: rows.length - total,
    advances: total === 0 ? 0 : changeCoverage.reliable ? advances : null,
    declines: total === 0 ? 0 : changeCoverage.reliable ? declines : null,
    // Match the report: names with no usable change land in "unchanged".
    unchanged: total === 0 ? 0 : changeCoverage.reliable ? total - advances - declines : null,
    changeCoverage,
    newHighs: high52Coverage.reliable ? newHighs : null,
    newLows: low52Coverage.reliable ? newLows : null,
    high52Coverage,
    low52Coverage,
    avgChange: changeCoverage.reliable ? round4(changes.reduce((a, b) => a + b, 0) / changes.length) : null,
    medianChange: changeCoverage.reliable ? round4(median(changes)) : null,
    upVolumeCount: volumeCoverage.reliable ? upVolumeCount : null,
    downVolumeCount: volumeCoverage.reliable ? downVolumeCount : null,
    volumeCoverage,
  };
}
