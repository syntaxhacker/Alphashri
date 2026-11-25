import type { SectorHistorySeasonality, SectorHistorySeries } from "../../../types/sectorHistory";

const BASE_INDEX = 100;
const PERCENT = 100;
const MONTHS_PER_YEAR = 12;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface SeasonalityMonthRow {
  month: number;
  label: string;
  avg: number | null;
  /** Percentage points, clamped to 0–100, matching the radial chart display. */
  hitRate: number | null;
  n: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rowsByMonth(
  cells: SectorHistorySeasonality[],
  sector: string,
): Map<number, SectorHistorySeasonality> {
  // The API may send months as 0- or 1-based; the full-year range disambiguates them.
  const zeroBased =
    cells.some((cell) => cell.month === 0) && !cells.some((cell) => cell.month === 12);
  const byMonth = new Map<number, SectorHistorySeasonality>();
  for (const cell of cells) {
    if (cell.name !== sector) continue;
    const index = zeroBased ? cell.month : cell.month - 1;
    if (index >= 0 && index < MONTHS_PER_YEAR) byMonth.set(index, cell);
  }
  return byMonth;
}

function sampleCounts(cells: SectorHistorySeasonality[], sector: string): number[] {
  return [...rowsByMonth(cells, sector).values()]
    .map((cell) => cell.n)
    .filter((value) => finite(value) && value > 0)
    .map((value) => Math.round(value));
}

/** Compounds percentage returns from `start`; null gaps break the line but not the factor. */
export function compoundReturns(values: (number | null)[], start = BASE_INDEX): (number | null)[] {
  const base = finite(start) ? start : BASE_INDEX;
  let factor = 1;
  return values.map((value) => {
    if (!finite(value)) return null;
    const next = factor * (1 + Math.max(-PERCENT, value) / PERCENT);
    if (!Number.isFinite(next)) return null;
    factor = next;
    const index = factor * base;
    return Number.isFinite(index) ? index : null;
  });
}

/** Compounded index weighted to the month axis; the 100 base applies before the first finite return. */
export function buildIndexSeries(months: string[], returns: (number | null)[]): (number | null)[] {
  return compoundReturns(months.map((_, index) => returns[index] ?? null));
}

/** Running-peak drawdown; the peak starts at the 100 index base, as in the underwater chart. */
export function drawdownSeries(indices: (number | null)[]): (number | null)[] {
  let peak = BASE_INDEX;
  return indices.map((index) => {
    if (!finite(index)) return null;
    peak = Math.max(peak, index);
    const drawdown = index / peak - 1;
    return Number.isFinite(drawdown) ? drawdown : null;
  });
}

/** Sector / benchmark cumulative ratio, normalized to 100 at the first common month. */
export function relativeStrengthSeries(
  months: string[],
  sectorReturns: (number | null)[],
  benchmarkReturns: (number | null)[],
): (number | null)[] {
  const sectorIndex = buildIndexSeries(months, sectorReturns);
  const benchmarkIndex = buildIndexSeries(months, benchmarkReturns);
  const rawRatios: (number | null)[] = months.map((_, index) => {
    const sectorClose = sectorIndex[index];
    const benchmarkClose = benchmarkIndex[index];
    if (!finite(sectorClose) || !finite(benchmarkClose) || benchmarkClose <= 0) return null;
    const ratio = sectorClose / benchmarkClose;
    return Number.isFinite(ratio) ? ratio : null;
  });

  let baseRatio: number | null = null;
  for (const ratio of rawRatios) {
    if (finite(ratio)) {
      baseRatio = ratio;
      break;
    }
  }
  if (baseRatio === null || baseRatio <= 0) return rawRatios.map(() => null);

  return rawRatios.map((ratio) => {
    if (!finite(ratio)) return null;
    const normalized = (ratio / baseRatio) * BASE_INDEX;
    return Number.isFinite(normalized) ? normalized : null;
  });
}

/** Twelve calendar rows for one sector, with hit rates converted to percentages. */
export function seasonalityByMonth(
  cells: SectorHistorySeasonality[],
  sector: string,
): SeasonalityMonthRow[] {
  const byMonth = rowsByMonth(cells, sector);
  return MONTH_LABELS.map((label, month) => {
    const cell = byMonth.get(month);
    const avg = cell && finite(cell.avg_return) ? cell.avg_return : null;
    const rawHitRate = cell?.hit_rate ?? null;
    const hitRate = finite(rawHitRate)
      ? clamp(rawHitRate <= 1 ? rawHitRate * PERCENT : rawHitRate, 0, PERCENT)
      : null;
    const n = cell && finite(cell.n) && cell.n > 0 ? Math.round(cell.n) : 0;
    return { month, label, avg, hitRate, n };
  });
}

/** Per-month observation range, e.g. `n=5 per month` or `n=3–5 per month`. */
export function seasonalitySampleLabel(
  cells: SectorHistorySeasonality[],
  sector: string,
  fallback = "",
): string {
  const counts = sampleCounts(cells, sector);
  if (counts.length === 0) return fallback;
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `n=${min} per month` : `n=${min}–${max} per month`;
}

/** Counts adjacent month pairs where both ranks are observed, excluding benchmarks. */
export function monthlyTransitionCount(series: SectorHistorySeries[]): number {
  let count = 0;
  for (const item of series) {
    if (item.is_benchmark) continue;
    const ranks = Array.isArray(item.ranks) ? item.ranks : [];
    for (let index = 0; index < ranks.length - 1; index++) {
      if (rankAt(item, index) !== null && rankAt(item, index + 1) !== null) count++;
    }
  }
  return count;
}

export function rankAt(series: SectorHistorySeries, index: number): number | null {
  const rank = Array.isArray(series.ranks) ? series.ranks[index] : null;
  return typeof rank === "number" && Number.isFinite(rank) ? rank : null;
}
