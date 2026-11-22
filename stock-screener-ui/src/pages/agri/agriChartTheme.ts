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

export type OptionFragment = Record<string, unknown>;

export interface ThemeTokens {
  text: string;
  muted: string;
  border: string;
  split: string;
  tooltipBg: string;
  crosshair: string;
}

// Theme is a boolean, so both token sets are built once and reused by every chart.
const DARK_TOKENS: ThemeTokens = Object.freeze({
  text: CHART_DARK_TEXT,
  muted: CHART_DARK_MUTED,
  border: BORDER,
  split: CHART_DARK_SPLIT,
  tooltipBg: CHART_DARK_OVERLAY,
  crosshair: CHART_CROSSHAIR,
});

const LIGHT_TOKENS: ThemeTokens = Object.freeze({
  text: CHART_LIGHT_TEXT,
  muted: CHART_LIGHT_MUTED,
  border: CHART_LIGHT_BORDER,
  split: CHART_LIGHT_SPLIT,
  tooltipBg: CHART_LIGHT_OVERLAY,
  crosshair: CHART_CROSSHAIR,
});

export function themeTokens(isDark: boolean): ThemeTokens {
  return isDark ? DARK_TOKENS : LIGHT_TOKENS;
}

/**
 * One vertical rhythm for every agri chart: title → (subtext) → legend → plot.
 * ECharts measures text from the container edge, so the legend and grid offsets
 * leave a real gap after each block instead of letting a wrapped subtext or a
 * legend sit on the plot's top edge.
 */
export const CHART_LAYOUT = Object.freeze({
  font: 10,
  titleFont: 12,
  titleTop: 4,
  titleItemGap: 8,
  legendTop: 26,
  legendTopWithSubtext: 46,
  gridTop: 56,
  gridTopWithSubtext: 72,
  gridBottom: 64,
  gridBottomWithZoom: 76,
  gridBottomHeatmap: 84,
  axisMargin: 10,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NUMBER_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const INDEX_FMT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const COMPACT_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatAgriDateLabel(date: string): string {
  if (typeof date !== "string") return "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (day) {
    const month = MONTHS[Number(day[2]) - 1];
    return month ? `${day[3]} ${month}` : date;
  }
  return /^\d{4}-\d{2}$/.test(date) ? date : date.slice(0, 10);
}

export function formatAgriValue(value: number | null | undefined, unit: string): string {
  const n = finite(value);
  if (n == null) return "—";
  const formatted = NUMBER_FMT.format(n);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function compactAxisLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${COMPACT_FMT.format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${COMPACT_FMT.format(value / 1_000)}k`;
  return NUMBER_FMT.format(value);
}

export function formatIndexLevel(value: number): string {
  return INDEX_FMT.format(value);
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${INDEX_FMT.format(value)}%`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface TooltipParam {
  dataIndex?: number;
  seriesName?: string;
  axisValue?: unknown;
  value?: unknown;
  marker?: string;
}

function isParam(value: unknown): value is TooltipParam {
  return typeof value === "object" && value !== null;
}

export function asParams(params: unknown): TooltipParam[] {
  if (Array.isArray(params)) return params.filter(isParam);
  return isParam(params) ? [params] : [];
}

export function tooltipShell(header: string, rows: string[]): string {
  return `<div style="font-family:monospace;font-size:11px;line-height:1.5">` +
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(header)}</div>` +
    rows.filter((row) => row !== "").join("") +
    `</div>`;
}

export function field(label: string, value: string): string {
  return `<div>${escapeHtml(label)}: <b>${value}</b></div>`;
}

export function categoryAxis(dates: string[], t: ThemeTokens, gridIndex: number, showLabels: boolean): OptionFragment {
  return {
    type: "category",
    gridIndex,
    data: dates,
    boundaryGap: gridIndex === 1,
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: showLabels
      ? {
          color: t.muted,
          fontSize: CHART_LAYOUT.font,
          interval: "auto",
          hideOverlap: true,
          margin: CHART_LAYOUT.axisMargin,
        }
      : { show: false },
    splitLine: { show: false },
  };
}

export function valueAxis(t: ThemeTokens, gridIndex: number, name?: string): OptionFragment {
  return {
    type: "value",
    gridIndex,
    scale: true,
    name,
    nameTextStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: CHART_LAYOUT.font, formatter: (value: number) => compactAxisLabel(value) },
    splitLine: { lineStyle: { color: t.split, type: "dashed" } },
  };
}

export function makeDataZoom(t: ThemeTokens, xAxisIndex: number[], start = 0): OptionFragment[] {
  return [
    { type: "inside", xAxisIndex, start, end: 100 },
    {
      type: "slider",
      xAxisIndex,
      start,
      end: 100,
      height: 18,
      bottom: 8,
      borderColor: t.border,
      textStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
    },
  ];
}

export function baseOption(
  t: ThemeTokens,
  title: string,
  legend: string[],
  formatter: (params: unknown) => string,
  subtext?: string,
): OptionFragment {
  return {
    animation: false,
    // The panel owns the surface; painting a plot background here clashes with
    // it whenever the caller's theme flag disagrees with the active CSS theme.
    backgroundColor: "transparent",
    title: {
      text: title,
      subtext: subtext || undefined,
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
      trigger: "axis",
      axisPointer: { type: "cross", lineStyle: { color: t.crosshair } },
      backgroundColor: t.tooltipBg,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 11 },
      formatter,
    },
  };
}

export function titled(mode: string, asOf?: string): string {
  return asOf ? `${mode} · as of ${asOf}` : mode;
}
