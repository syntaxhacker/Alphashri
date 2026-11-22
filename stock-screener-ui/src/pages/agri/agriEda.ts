/**
 * Pure, deterministic EDA statistics for the daily agri modal-price series.
 * No DOM, network, clock, or external stats dependency — plain TS + Math only.
 * Every non-finite input (null / undefined / NaN / ±Infinity) is treated as
 * missing, and every numeric output is finite or `null`.
 */

export interface AgriEdaPoint {
  date: string;
  modal: number | null;
  min: number | null;
  max: number | null;
  arrivals_qtl: number | null;
  market_count: number;
}

export interface AgriEdaComparePoint {
  date: string;
  modal: number | null;
}

export interface AgriEdaCompareSeries {
  key: string;
  label: string;
  points: AgriEdaComparePoint[];
}

export interface MonthlyBox {
  month: string;
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
}

export interface RollingPoint {
  date: string;
  modal: number | null;
  mean: number | null;
  lower: number | null;
  upper: number | null;
  volatility: number | null;
}

export interface SeasonalityBucket {
  /** Calendar month, 1 = Jan … 12 = Dec. */
  month: number;
  avg: number;
  median: number;
  min: number;
  max: number;
  years: number;
  count: number;
}

export interface SeasonalityResult {
  months: SeasonalityBucket[];
  weak: boolean;
}

export interface SupplyDemandPoint {
  date: string;
  arrivals_qtl: number | null;
  /** Same-day modal, for comparison with the aligned value. */
  modal: number | null;
  /** Modal at `date + lagDays`. */
  laggedModal: number | null;
}

export interface SupplyDemandResult {
  points: SupplyDemandPoint[];
  pearson: number | null;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
  n: number;
}

export interface HeatmapMonth {
  month: string;
  modal: number;
}

export interface HeatmapRow {
  key: string;
  label: string;
  months: HeatmapMonth[];
}

export interface OutlierPoint {
  date: string;
  modal: number;
  lowFence: number;
  highFence: number;
  side: "low" | "high";
}

export interface EdaSummary {
  trendPct: number | null;
  volatilityPct: number | null;
  bestMonth: number | null;
  worstMonth: number | null;
  arrivalsCorrelation: number | null;
  outlierCount: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const BAND_WIDTH = 1.5;
const IQR_MULTIPLIER = 1.5;

/** A finite number, or `null` for null / undefined / NaN / ±Infinity. */
function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function rowsOf(series: AgriEdaPoint[] | null | undefined): AgriEdaPoint[] {
  return Array.isArray(series) ? series : [];
}

function modalOf(point: AgriEdaPoint | null | undefined): number | null {
  return finite(point?.modal);
}

function arrivalsOf(point: AgriEdaPoint | null | undefined): number | null {
  return finite(point?.arrivals_qtl);
}

/** `YYYY-MM` bucket plus month index; rejects non-strings and month 13+. */
function monthParts(date: unknown): { key: string; year: string; month: number; mm: string } | null {
  if (typeof date !== "string") return null;
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return null;
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { key: `${match[1]}-${match[2]}`, year: match[1], month, mm: match[2] };
}

function monthLabel(key: string): string {
  const parts = monthParts(key);
  if (!parts) return key;
  const name = MONTHS[parts.month - 1] ?? parts.mm;
  return `${name} ${parts.year.slice(2)}`;
}

function meanOf(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Population standard deviation (divide by n), documented for the band. */
function stdOf(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) {
    const delta = value - mean;
    sum += delta * delta;
  }
  return Math.sqrt(sum / values.length);
}

/** Linear interpolation between order statistics (R type 7). */
function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function sortedModals(series: AgriEdaPoint[] | null | undefined): number[] {
  const values: number[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value != null) values.push(value);
  }
  return values.sort((a, b) => a - b);
}

function normalizeWindow(window: number): number {
  return Number.isFinite(window) ? Math.max(1, Math.floor(window)) : 7;
}

function addDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const shifted = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(shifted.getTime())) return "";
  shifted.setUTCDate(shifted.getUTCDate() + Math.trunc(days));
  return shifted.toISOString().slice(0, 10);
}

/** Distribution of the modal price per calendar month — the box-plot input. */
export function monthlyBox(series: AgriEdaPoint[] | null | undefined): MonthlyBox[] {
  const byMonth = new Map<string, number[]>();
  for (const point of rowsOf(series)) {
    const parts = monthParts(point?.date);
    const value = modalOf(point);
    if (!parts || value == null) continue;
    const bucket = byMonth.get(parts.key);
    if (bucket) bucket.push(value);
    else byMonth.set(parts.key, [value]);
  }
  const boxes: MonthlyBox[] = [];
  for (const month of [...byMonth.keys()].sort()) {
    const values = (byMonth.get(month) as number[]).slice().sort((a, b) => a - b);
    boxes.push({
      month,
      label: monthLabel(month),
      min: values[0],
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75),
      max: values[values.length - 1],
      mean: meanOf(values),
      count: values.length,
    });
  }
  return boxes;
}

/**
 * Trailing band over the most recent `window` finite modal observations.
 * A row emits values only once it has `window` finite values (including its
 * own), so the warmup is null; std is population std and the band is
 * `mean ± 1.5 * std`.
 */
export function rollingStats(series: AgriEdaPoint[] | null | undefined, window = 7): RollingPoint[] {
  const rows = rowsOf(series);
  const size = normalizeWindow(window);
  const values = rows.map(modalOf);
  const output: RollingPoint[] = [];
  for (let i = 0; i < rows.length; i++) {
    const current = values[i];
    let mean: number | null = null;
    let volatility: number | null = null;
    if (current != null) {
      const trailing: number[] = [];
      for (let j = i; j >= 0 && trailing.length < size; j--) {
        const value = values[j];
        if (value != null) trailing.push(value);
      }
      if (trailing.length >= size) {
        mean = meanOf(trailing);
        volatility = stdOf(trailing, mean);
      }
    }
    output.push({
      date: rows[i]?.date ?? "",
      modal: current,
      mean: finite(mean),
      lower: mean != null && volatility != null ? finite(mean - BAND_WIDTH * volatility) : null,
      upper: mean != null && volatility != null ? finite(mean + BAND_WIDTH * volatility) : null,
      volatility: finite(volatility),
    });
  }
  return output;
}

/** Month-of-year aggregates. `weak` is true when fewer than two years exist. */
export function seasonality(series: AgriEdaPoint[] | null | undefined): SeasonalityResult {
  const byMonth = new Map<number, number[]>();
  const years = new Map<number, Set<string>>();
  const allYears = new Set<string>();
  for (const point of rowsOf(series)) {
    const parts = monthParts(point?.date);
    const value = modalOf(point);
    if (!parts || value == null) continue;
    allYears.add(parts.year);
    const values = byMonth.get(parts.month);
    if (values) values.push(value);
    else byMonth.set(parts.month, [value]);
    const seen = years.get(parts.month);
    if (seen) seen.add(parts.year);
    else years.set(parts.month, new Set([parts.year]));
  }
  const months: SeasonalityBucket[] = [];
  for (const month of [...byMonth.keys()].sort((a, b) => a - b)) {
    const values = (byMonth.get(month) as number[]).slice().sort((a, b) => a - b);
    months.push({
      month,
      avg: meanOf(values),
      median: quantile(values, 0.5),
      min: values[0],
      max: values[values.length - 1],
      years: (years.get(month) as Set<string>).size,
      count: values.length,
    });
  }
  return { months, weak: allYears.size < 2 };
}

/** Alignment of arrivals with the modal `lagDays` later, plus OLS on finite pairs. */
export function supplyDemand(series: AgriEdaPoint[] | null | undefined, lagDays = 0): SupplyDemandResult {
  const rows = rowsOf(series);
  const lag = Number.isFinite(lagDays) ? Math.trunc(lagDays) : 0;
  const modalByDate = new Map<string, number>();
  for (const point of rows) {
    const value = modalOf(point);
    // Duplicate dates: the last finite modal wins, so nulls never clobber a value.
    if (value != null && typeof point?.date === "string") modalByDate.set(point.date, value);
  }

  const points: SupplyDemandPoint[] = rows.map((point) => {
    const date = typeof point?.date === "string" ? point.date : "";
    return {
      date,
      arrivals_qtl: arrivalsOf(point),
      modal: modalOf(point),
      laggedModal: finite(modalByDate.get(addDays(date, lag)) ?? null),
    };
  });

  const pairs: Array<{ x: number; y: number }> = [];
  for (const point of points) {
    if (point.arrivals_qtl != null && point.laggedModal != null) {
      pairs.push({ x: point.arrivals_qtl, y: point.laggedModal });
    }
  }

  let pearson: number | null = null;
  let slope: number | null = null;
  let intercept: number | null = null;
  let r2: number | null = null;
  if (pairs.length >= 2) {
    const xMean = meanOf(pairs.map((p) => p.x));
    const yMean = meanOf(pairs.map((p) => p.y));
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    for (const pair of pairs) {
      const dx = pair.x - xMean;
      const dy = pair.y - yMean;
      sumXX += dx * dx;
      sumYY += dy * dy;
      sumXY += dx * dy;
    }
    if (sumXX > 0 && sumYY > 0) {
      const correlation = sumXY / Math.sqrt(sumXX * sumYY);
      pearson = finite(correlation);
      r2 = finite(correlation * correlation);
    }
    if (sumXX > 0) {
      const gradient = sumXY / sumXX;
      slope = finite(gradient);
      intercept = finite(yMean - gradient * xMean);
    }
  }

  return { points, pearson, slope, intercept, r2, n: pairs.length };
}

/** Mean modal per `YYYY-MM` for each comparison series, ordered by input. */
export function monthlyHeatmap(seriesByKey: AgriEdaCompareSeries[] | null | undefined): HeatmapRow[] {
  const source = Array.isArray(seriesByKey) ? seriesByKey : [];
  const rows: HeatmapRow[] = [];
  for (const entry of source) {
    if (!entry || typeof entry.key !== "string") continue;
    const byMonth = new Map<string, number[]>();
    for (const point of Array.isArray(entry.points) ? entry.points : []) {
      const parts = monthParts(point?.date);
      const value = finite(point?.modal);
      if (!parts || value == null) continue;
      const bucket = byMonth.get(parts.key);
      if (bucket) bucket.push(value);
      else byMonth.set(parts.key, [value]);
    }
    const months: HeatmapMonth[] = [];
    for (const month of [...byMonth.keys()].sort()) {
      const values = byMonth.get(month) as number[];
      months.push({ month, modal: meanOf(values) });
    }
    rows.push({ key: entry.key, label: typeof entry.label === "string" ? entry.label : entry.key, months });
  }
  return rows;
}

/** Tukey fences from all finite modals; one record per outlying observation. */
export function iqrOutliers(series: AgriEdaPoint[] | null | undefined): OutlierPoint[] {
  const sorted = sortedModals(series);
  if (sorted.length === 0) return [];
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - IQR_MULTIPLIER * iqr;
  const highFence = q3 + IQR_MULTIPLIER * iqr;
  const outliers: OutlierPoint[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value == null) continue;
    const side = value < lowFence ? "low" : value > highFence ? "high" : null;
    if (side == null) continue;
    outliers.push({ date: point.date, modal: value, lowFence, highFence, side });
  }
  return outliers;
}

/**
 * One-line EDA summary: trend is the first-to-last modal change, volatility is
 * the modal coefficient of variation, best/worst are the seasonality months
 * with the highest/lowest average. All numbers are finite or `null`.
 */
export function summariseEda(series: AgriEdaPoint[] | null | undefined): EdaSummary {
  const values: number[] = [];
  for (const point of rowsOf(series)) {
    const value = modalOf(point);
    if (value != null) values.push(value);
  }
  const first = values[0];
  const last = values[values.length - 1];
  const mean = values.length > 0 ? meanOf(values) : null;
  const volatility = mean != null ? stdOf(values, mean) : null;

  const seasonal = seasonality(series).months;
  let best: SeasonalityBucket | null = null;
  let worst: SeasonalityBucket | null = null;
  for (const bucket of seasonal) {
    if (best == null || bucket.avg > best.avg) best = bucket;
    if (worst == null || bucket.avg < worst.avg) worst = bucket;
  }

  return {
    trendPct: first != null && last != null && first !== 0 ? finite(((last - first) / first) * 100) : null,
    volatilityPct: mean != null && volatility != null && mean !== 0 ? finite((volatility / mean) * 100) : null,
    bestMonth: best?.month ?? null,
    worstMonth: worst?.month ?? null,
    arrivalsCorrelation: supplyDemand(series).pearson,
    outlierCount: iqrOutliers(series).length,
  };
}
