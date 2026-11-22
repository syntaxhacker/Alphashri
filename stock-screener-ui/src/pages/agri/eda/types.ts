import { CHANGE_WINDOWS } from "./constants";

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

export type ChangeWindow = (typeof CHANGE_WINDOWS)[number]["key"];

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
  /** Observations used by the trailing window (0 while warming up). */
  n: number;
  /** Calendar days since the previous dated observation; null when unmeasurable. */
  gapDays: number | null;
  /** Gap breaks that truncated this row's trailing window (0 or 1). */
  skippedGaps: number;
}

export interface RealizedVolatilityResult {
  /** Population std of finite log returns; null when fewer than two returns survive. */
  value: number | null;
  /** Log returns actually used. */
  n: number;
  /** Adjacent pairs dropped because they crossed more than `maxGapDays`. */
  skippedGaps: number;
}

export interface ChangeAnchor {
  window: ChangeWindow;
  targetDate: string | null;
  toleranceDays: number;
  /** Latest observation at or before `targetDate`. */
  date: string | null;
  /** Anchor date minus target date, in days (0 when exact). */
  daysFromTarget: number | null;
  withinTolerance: boolean;
  modal: number | null;
  /** Direction change from the anchor to the current modal; null across a gap. */
  changePct: number | null;
}

export interface ChangeMatrix {
  key: string;
  label: string;
  /** Latest observation date with a finite modal. */
  asOf: string | null;
  modal: number | null;
  /** Distinct dated observations with a finite modal. */
  n: number;
  changes: Record<ChangeWindow, number | null>;
  anchors: Record<ChangeWindow, ChangeAnchor>;
}

export type GroupPulseRow = ChangeMatrix;

export interface ChangeMatrixOptions {
  key?: string;
  label?: string;
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
