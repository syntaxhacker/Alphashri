import {
  BORDER,
  CHART_CROSSHAIR,
  CHART_DARK_MUTED,
  CHART_DARK_OVERLAY,
  CHART_DARK_SPLIT,
  CHART_DARK_TEXT,
  CHART_LIGHT_BORDER,
  CHART_LIGHT_MUTED,
  CHART_LIGHT_OVERLAY,
  CHART_LIGHT_SPLIT,
  CHART_LIGHT_TEXT,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import { CHART_LAYOUT } from "../agriChartTheme";

export { CHART_LAYOUT };

export interface EdaSeriesPoint {
  date: string;
  modal: number | null;
  min: number | null;
  max: number | null;
  arrivals_qtl: number | null;
  market_count: number;
}

export interface EdaComparisonSeries {
  key: string;
  label: string;
  points: { date: string; modal: number | null }[];
}

export interface EdaBox {
  /** Calendar key (`YYYY-MM`, month name or 1–12); numeric months are accepted. */
  month: string | number;
  label?: string;
  /** Alias for `mean`, used by month-of-year buckets that call it `avg`. */
  avg?: number | null;
  min: number | null;
  q1?: number | null;
  median: number | null;
  q3?: number | null;
  max: number | null;
  mean?: number | null;
  count: number;
  /** Distinct calendar years, when the bucket is month-of-year seasonality. */
  years?: number;
  /** Observed values beyond the 1.5×IQR fences, when the backend has them. */
  outliers?: number[] | null;
}

export interface EdaScatter {
  points: {
    date: string;
    arrivals_qtl: number | null;
    modal: number | null;
    laggedModal: number | null;
  }[];
  pearson: number | null;
  slope: number | null;
  intercept: number | null;
  r2: number | null;
  n: number;
}

export interface EdaHeatmapRow {
  key: string;
  label: string;
  months: { month: string; modal: number | null }[];
}

export type EdaMode = "distribution" | "supplyDemand" | "heatmap" | "rolling" | "seasonality";

export interface EdaDistributionInput {
  boxes?: EdaBox[] | null;
  unit?: string;
  isDark?: boolean;
  compact?: boolean;
}

export interface EdaSupplyDemandInput {
  scatter?: EdaScatter | null;
  unit?: string;
  arrivalsUnit?: string;
  isDark?: boolean;
  compact?: boolean;
}

export interface EdaHeatmapInput {
  rows?: EdaHeatmapRow[] | null;
  isDark?: boolean;
  compact?: boolean;
}

export interface EdaRollingInput {
  series?: EdaSeriesPoint[] | null;
  /** Window length in observations. `window` takes precedence over `rolling`. */
  window?: number;
  rolling?: number;
  isDark?: boolean;
  compact?: boolean;
}

export interface EdaSeasonalityInput {
  seasonality?: EdaBox[] | null;
  unit?: string;
  isDark?: boolean;
  compact?: boolean;
}

export type EdaOptionInput =
  | EdaDistributionInput
  | EdaSupplyDemandInput
  | EdaHeatmapInput
  | EdaRollingInput
  | EdaSeasonalityInput;

export type Option = Record<string, unknown>;
export type Series = Record<string, unknown>;
export type Formatter = (params: unknown) => string;

export interface ThemeTokens {
  text: string;
  muted: string;
  border: string;
  split: string;
  tooltipBg: string;
  crosshair: string;
}

export interface TooltipParam {
  dataIndex?: number;
  seriesName?: string;
  axisValue?: unknown;
  value?: unknown;
  marker?: string;
}

export const DEFAULT_UNIT = "₹/quintal";
export const DEFAULT_ARRIVALS_UNIT = "qtl";
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const NUMBER_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const STAT_FMT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unitOf(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

export function formatValue(value: number | null | undefined, unit: string = DEFAULT_UNIT): string {
  const n = finite(value);
  return n == null ? "—" : `${NUMBER_FMT.format(n)}${unit ? ` ${unit}` : ""}`;
}

export function formatCount(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? "—" : NUMBER_FMT.format(n);
}

export function formatStat(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? "—" : STAT_FMT.format(n);
}

export function boxMean(box: EdaBox): number | null {
  return finite(box.mean) ?? finite(box.avg);
}

export function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is T => typeof entry === "object" && entry !== null);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isParam(value: unknown): value is TooltipParam {
  return typeof value === "object" && value !== null;
}

export function asParams(params: unknown): TooltipParam[] {
  if (Array.isArray(params)) return params.filter(isParam);
  return isParam(params) ? [params] : [];
}

export function tooltipShell(header: string, rows: string[]): string {
  return `<div style="font-family:monospace;font-size:${typeSize("micro")}px;line-height:1.5">` +
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(header)}</div>` +
    rows.filter((row) => row !== "").join("") +
    "</div>";
}

export function field(label: string, value: string): string {
  return `<div>${escapeHtml(label)}: <b>${value}</b></div>`;
}

export function paramIndex(params: unknown): number {
  const found = asParams(params).find((p) => Number.isInteger(p.dataIndex));
  return found?.dataIndex ?? -1;
}

export function themeTokens(isDark: boolean | undefined): ThemeTokens {
  return isDark === false
    ? {
        text: CHART_LIGHT_TEXT,
        muted: CHART_LIGHT_MUTED,
        border: CHART_LIGHT_BORDER,
        split: CHART_LIGHT_SPLIT,
        tooltipBg: CHART_LIGHT_OVERLAY,
        crosshair: CHART_CROSSHAIR,
      }
    : {
        text: CHART_DARK_TEXT,
        muted: CHART_DARK_MUTED,
        border: BORDER,
        split: CHART_DARK_SPLIT,
        tooltipBg: CHART_DARK_OVERLAY,
        crosshair: CHART_CROSSHAIR,
      };
}

export function baseOption(
  t: ThemeTokens,
  title: string,
  legend: string[],
  formatter: Formatter,
  subtext?: string,
  trigger: "axis" | "item" = "axis",
): Option {
  return {
    animation: false,
    // The panel owns the surface; a plot background here would fight the CSS theme.
    backgroundColor: "transparent",
    title: {
      text: title,
      subtext,
      left: "center",
      top: CHART_LAYOUT.titleTop,
      itemGap: CHART_LAYOUT.titleItemGap,
      textStyle: { color: t.text, fontSize: CHART_LAYOUT.titleFont },
      subtextStyle: { color: t.muted, fontSize: CHART_LAYOUT.font, lineHeight: 14 },
    },
    legend: {
      show: legend.length > 0,
      top: subtext ? CHART_LAYOUT.legendTopWithSubtext : CHART_LAYOUT.legendTop,
      data: legend,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
    },
    tooltip: {
      trigger,
      axisPointer: { type: "cross", lineStyle: { color: t.crosshair } },
      backgroundColor: t.tooltipBg,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: typeSize("micro") },
      formatter,
    },
  };
}

export function compactAxisLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${STAT_FMT.format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${STAT_FMT.format(value / 1_000)}k`;
  return NUMBER_FMT.format(value);
}

export function valueAxis(t: ThemeTokens, name?: string): Series {
  return {
    type: "value",
    scale: true,
    name,
    nameTextStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: CHART_LAYOUT.font, formatter: (value: number) => compactAxisLabel(value) },
    splitLine: { lineStyle: { color: t.split, type: "dashed" } },
  };
}

export function categoryAxis(
  data: string[],
  t: ThemeTokens,
  opts: { showLabels?: boolean; rotate?: number; width?: number; interval?: number | "auto" } = {},
): Series {
  const show = opts.showLabels !== false;
  return {
    type: "category",
    data,
    boundaryGap: true,
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: show
      ? {
          color: t.muted,
          fontSize: CHART_LAYOUT.font,
          interval: opts.interval ?? "auto",
          hideOverlap: true,
          rotate: opts.rotate ?? 0,
          margin: CHART_LAYOUT.axisMargin,
          width: opts.width,
          overflow: "truncate",
        }
      : { show: false },
    splitLine: { show: false },
  };
}

export function makeDataZoom(t: ThemeTokens, xAxisIndex: number[]): Series[] {
  return [
    { type: "inside", xAxisIndex, start: 0, end: 100 },
    {
      type: "slider",
      xAxisIndex,
      start: 0,
      end: 100,
      height: 18,
      bottom: 8,
      borderColor: t.border,
      textStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
    },
  ];
}

export function monthIndex(month: unknown): number {
  if (typeof month === "number" && Number.isInteger(month)) {
    return month >= 1 && month <= 12 ? month - 1 : -1;
  }
  if (typeof month !== "string") return -1;
  const raw = month.trim();
  const short = raw.slice(0, 3).toLowerCase();
  const named = MONTHS.findIndex((m) => m.toLowerCase() === short);
  if (named >= 0) return named;
  const full = FULL_MONTHS.indexOf(raw.toLowerCase());
  if (full >= 0) return full;
  const numeric = /^(?:\d{4}[-/])?(\d{1,2})(?:[-/]\d{1,2})?$/.exec(raw);
  if (!numeric) return -1;
  const n = Number(numeric[1]);
  return n >= 1 && n <= 12 ? n - 1 : -1;
}

export function monthLabel(month: unknown): string {
  const index = monthIndex(month);
  if (index >= 0) return MONTHS[index];
  return typeof month === "string" && month.trim() !== "" ? month.trim().slice(0, 10) : "—";
}
