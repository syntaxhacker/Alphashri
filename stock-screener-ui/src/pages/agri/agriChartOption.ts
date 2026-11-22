import {
  alpha,
  INFO,
  NEGATIVE,
  ORB_AREA,
  POSITIVE,
  PRIMARY,
  SCALE_CYAN,
  SCALE_VIOLET,
} from "@/ui/palette";
import {
  asParams,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  escapeHtml,
  field,
  finite,
  formatAgriDateLabel,
  formatAgriValue,
  formatIndexLevel,
  formatPct,
  makeDataZoom,
  themeTokens,
  titled,
  tooltipShell,
  valueAxis,
  type OptionFragment,
  type ThemeTokens,
} from "./agriChartTheme";

export { formatAgriDateLabel, formatAgriValue } from "./agriChartTheme";

export type AgriChartMode = "band" | "arrivals" | "compare" | "ohlc";

export interface AgriChartSeriesPoint {
  date: string;
  modal: number | null;
  min: number | null;
  max: number | null;
  arrivals_qtl: number | null;
  market_count: number;
}

export interface AgriComparisonPoint {
  date: string;
  modal: number | null;
}

export interface AgriComparisonSeries {
  key: string;
  label: string;
  points: AgriComparisonPoint[];
}

export interface AgriChartInput {
  mode: AgriChartMode;
  series: AgriChartSeriesPoint[];
  comparison: AgriComparisonSeries[];
  unit: string;
  isDark: boolean;
  asOf?: string;
}

/** A gap marker is an empty category, not an observation with zero markets. */
interface DisplayRow extends AgriChartSeriesPoint {
  gap: boolean;
}

const DEFAULT_UNIT = "₹/quintal";
const MAX_COMPARE = 5;
const MAX_CANDLES = 60;
const BAND_STACK = "agri-minmax-band";
const BAND_NAME = "Min–Max band";
const COMPARE_COLORS = [PRIMARY, INFO, POSITIVE, SCALE_VIOLET[4], SCALE_CYAN[4]];
const BAND_Q1_PCT = 0.25;
const BAND_Q3_PCT = 0.75;
const BAND_FENCE_IQR = 1.5;

function rowTooltip(
  params: unknown,
  rows: DisplayRow[],
  fields: (row: AgriChartSeriesPoint) => string[],
): string {
  const list = asParams(params);
  if (list.length === 0) return "";
  const withIndex = list.find((p) => Number.isInteger(p.dataIndex));
  const row = rows[withIndex?.dataIndex ?? 0];
  if (!row) return "";
  if (row.gap) {
    return tooltipShell("Data gap", [field("Interval", formatAgriDateLabel(row.date))]);
  }
  if (row.market_count === 0) return "";
  return tooltipShell(row.date, fields(row));
}

const GAP_BREAK_MS = 7 * 24 * 60 * 60 * 1000;

/** Insert one empty category between observations separated by a long gap. */
function addGapMarkers(dates: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < dates.length; i++) {
    const current = dates[i];
    if (i > 0) {
      const prev = dates[i - 1];
      const elapsed = Date.parse(`${current}T00:00:00Z`) - Date.parse(`${prev}T00:00:00Z`);
      if (elapsed > GAP_BREAK_MS) {
        const marker = new Date(Date.parse(`${prev}T00:00:00Z`) + 24 * 60 * 60 * 1000);
        out.push(marker.toISOString().slice(0, 10));
      }
    }
    out.push(current);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * Keep the modal line readable when a single extreme min/max would otherwise
 * dominate the value axis. The bounds use a 3×IQR fence over the band edges and
 * are widened to contain every modal value; tooltips still report the raw min/max.
 */
export function robustBandBounds(rows: AgriChartSeriesPoint[]): { min: number; max: number } | null {
  const edges = rows
    .flatMap((row) => [finite(row.min), finite(row.max)])
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const modals = rows
    .map((row) => finite(row.modal))
    .filter((value): value is number => value != null);
  if (edges.length === 0 && modals.length === 0) return null;
  const q1 = edges.length > 0 ? percentile(edges, BAND_Q1_PCT) : Math.min(...modals);
  const q3 = edges.length > 0 ? percentile(edges, BAND_Q3_PCT) : Math.max(...modals);
  const iqr = q3 - q1;
  // Prices are non-negative; without the clamp a low q1 can make the fence
  // negative and ECharts shows a meaningless negative price axis.
  let low = Math.max(0, q1 - BAND_FENCE_IQR * iqr);
  let high = q3 + BAND_FENCE_IQR * iqr;
  for (const modal of modals) {
    low = Math.min(low, modal);
    high = Math.max(high, modal);
  }
  const pad = Math.max((high - low) * 0.08, 1);
  return { min: Math.max(0, low - pad), max: high + pad };
}

function modalSeries(data: (number | null)[], gridIndex: number, yAxisIndex: number): OptionFragment {
  return {
    name: "Modal",
    type: "line",
    data,
    xAxisIndex: gridIndex,
    yAxisIndex,
    showSymbol: false,
    symbol: "none",
    lineStyle: { color: PRIMARY, width: 2 },
    itemStyle: { color: PRIMARY },
    emphasis: { focus: "series" },
    z: 5,
  };
}

function buildBand(
  rows: AgriChartSeriesPoint[],
  unit: string,
  t: ThemeTokens,
  asOf?: string,
): OptionFragment {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const display: DisplayRow[] = addGapMarkers(rows.map((r) => r.date)).map((date) => {
    const found = byDate.get(date);
    if (found) return { ...found, gap: false };
    return {
      date,
      modal: null,
      min: null,
      max: null,
      arrivals_qtl: null,
      market_count: 0,
      gap: true,
    };
  });
  const dates = display.map((r) => (r.gap ? "" : formatAgriDateLabel(r.date)));
  const min = display.map((r) => finite(r.min));
  // The upper stacked series carries only the span so ECharts fills the area
  // between min and max; the tooltip reads the raw values from the source row.
  // It is an informational range, so it reads as an INFO tint, never a grey wash.
  const span = display.map((r) => {
    const lo = finite(r.min);
    const hi = finite(r.max);
    return lo == null || hi == null ? null : Math.max(0, hi - lo);
  });
  const bounds = robustBandBounds(display.filter((r) => !r.gap));

  return {
    ...baseOption(
      t,
      titled("Modal price with min–max band", asOf),
      ["Modal", BAND_NAME],
      (params) =>
        rowTooltip(params, display, (row) => [
          field("Modal", formatAgriValue(row.modal, unit)),
          field("Min", formatAgriValue(row.min, unit)),
          field("Max", formatAgriValue(row.max, unit)),
          field("Markets", formatAgriValue(row.market_count, "")),
        ]),
    ),
    grid: [{ left: 56, right: 24, top: CHART_LAYOUT.gridTop, bottom: CHART_LAYOUT.gridBottomWithZoom, containLabel: true }],
    xAxis: [categoryAxis(dates, t, 0, true)],
    yAxis: [{ ...valueAxis(t, 0), ...bounds }],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      modalSeries(display.map((r) => finite(r.modal)), 0, 0),
      {
        name: "Min",
        type: "line",
        stack: BAND_STACK,
        data: min,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: alpha(INFO, 0) },
        silent: true,
        z: 1,
      },
      {
        name: BAND_NAME,
        type: "line",
        stack: BAND_STACK,
        data: span,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: ORB_AREA },
        silent: true,
        z: 2,
      },
    ],
  };
}

function buildArrivals(
  rows: AgriChartSeriesPoint[],
  unit: string,
  t: ThemeTokens,
  asOf?: string,
): OptionFragment {
  const dates = rows.map((r) => formatAgriDateLabel(r.date));
  const arrivals = rows.map((r) => finite(r.arrivals_qtl));

  return {
    ...baseOption(
      t,
      titled("Modal price & arrivals", asOf),
      ["Modal", "Arrivals"],
      (params) =>
        rowTooltip(params, rows.map((row) => ({ ...row, gap: false })), (row) => [
          field("Modal", formatAgriValue(row.modal, unit)),
          field("Arrivals", `${formatAgriValue(row.arrivals_qtl, "")} qtl`),
          field("Markets", formatAgriValue(row.market_count, "")),
        ]),
    ),
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 56, right: 56, top: CHART_LAYOUT.gridTop, height: "50%", containLabel: true },
      { left: 56, right: 56, top: "68%", bottom: 44, containLabel: true },
    ],
    xAxis: [categoryAxis(dates, t, 0, false), categoryAxis(dates, t, 1, true)],
    yAxis: [valueAxis(t, 0), valueAxis(t, 1, "qtl")],
    dataZoom: makeDataZoom(t, [0, 1]),
    series: [
      modalSeries(rows.map((r) => finite(r.modal)), 0, 0),
      {
        name: "Arrivals",
        type: "bar",
        data: arrivals,
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 18,
        barMinHeight: 2,
        // Arrivals are informational volume, never a bullish/bearish signal.
        itemStyle: { color: alpha(INFO, 0.55) },
        emphasis: { itemStyle: { color: INFO } },
        z: 1,
      },
    ],
  };
}

function uniqueLabels(labels: string[]): string[] {
  const counts = new Map<string, number>();
  return labels.map((label) => {
    const seen = counts.get(label) ?? 0;
    counts.set(label, seen + 1);
    return seen === 0 ? label : `${label} (${seen + 1})`;
  });
}

function buildCompare(
  comparisons: AgriComparisonSeries[],
  t: ThemeTokens,
  asOf?: string,
): OptionFragment {
  const selected = comparisons.slice(0, MAX_COMPARE);
  const prepared = selected
    .filter((c) => c && Array.isArray(c.points) && typeof c.key === "string")
    .map((c) => {
      const byDate = new Map<string, number>();
      for (const point of c.points) {
        if (!point || typeof point.date !== "string") continue;
        if (asOf && point.date > asOf) continue;
        const value = finite(point.modal);
        if (value != null) byDate.set(point.date, value);
      }
      return { label: c.label || c.key, byDate };
    });
  if (prepared.length === 0) return {};

  const allDates = [...new Set(prepared.flatMap((s) => [...s.byDate.keys()]))].sort();
  const commonFirst = allDates.find((date) => prepared.every((s) => s.byDate.get(date) != null));
  if (!commonFirst) return {};

  const dates = addGapMarkers(allDates.filter((date) => date >= commonFirst));
  const gapDates = new Set(dates.filter((date) => prepared.every((s) => s.byDate.get(date) == null)));
  const labels = uniqueLabels(prepared.map((s) => s.label));
  const series: OptionFragment[] = prepared.map((s, i) => {
    const base = s.byDate.get(commonFirst) as number;
    const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
    const data = dates.map((date) => {
      const value = s.byDate.get(date);
      if (value == null || base <= 0) return null;
      const indexed = (value / base) * 100;
      return Number.isFinite(indexed) ? Math.round(indexed * 10) / 10 : null;
    });
    return {
      name: labels[i],
      type: "line",
      data,
      showSymbol: false,
      symbol: "none",
      connectNulls: false,
      lineStyle: { color, width: 1.75 },
      itemStyle: { color },
      ...(i === 0
        ? {
            markLine: {
              silent: true,
              symbol: "none",
              data: [
                {
                  yAxis: 100,
                  lineStyle: { color: t.muted, type: "dashed" },
                  label: { formatter: "100 (base)", color: t.muted },
                },
              ],
            },
          }
        : {}),
    };
  });

  const compareTooltip = (params: unknown): string => {
    const list = asParams(params);
    if (list.length === 0) return "";
    const header =
      `${formatAgriDateLabel(String(list[0].axisValue ?? dates[0] ?? ""))}` +
      ` · indexed to 100 at ${formatAgriDateLabel(commonFirst)}`;
    const rows = list.map((p) => {
      const value = finite(typeof p.value === "number" ? p.value : null);
      if (value == null) return "";
      const pct = value - 100;
      return (
        `<div>${p.marker ?? ""}${escapeHtml(p.seriesName ?? "")}: ` +
        `<b>${formatIndexLevel(value)}</b> ` +
        `<span style="color:${pct >= 0 ? POSITIVE : NEGATIVE}">${formatPct(pct)}</span></div>`
      );
    });
    return tooltipShell(header, rows);
  };

  return {
    ...baseOption(t, titled("Modal price indexed to 100 at common start", asOf), labels, compareTooltip),
    grid: [{ left: 56, right: 24, top: CHART_LAYOUT.gridTop, bottom: CHART_LAYOUT.gridBottomWithZoom, containLabel: true }],
    xAxis: [categoryAxis(dates.map((date) => (gapDates.has(date) ? "" : formatAgriDateLabel(date))), t, 0, true)],
    yAxis: [valueAxis(t, 0)],
    dataZoom: makeDataZoom(t, [0]),
    series,
  };
}

function buildOhlc(
  rows: AgriChartSeriesPoint[],
  unit: string,
  t: ThemeTokens,
  asOf?: string,
): OptionFragment {
  const usable = rows.filter((r) => finite(r.modal) != null);
  if (usable.length === 0) return {};
  const dates = usable.map((r) => formatAgriDateLabel(r.date));
  const candles: number[][] = usable.map((r, i) => {
    const close = finite(r.modal) as number;
    const open = finite(usable[i - 1]?.modal) ?? close;
    const high = Math.max(finite(r.max) ?? close, open, close);
    const low = Math.min(finite(r.min) ?? close, open, close);
    return [open, close, low, high];
  });
  const name = "Proxy OHLC (min · prev modal · modal · max)";
  // Six-minute rows produce unreadable wick density at full extent, so open
  // zoomed into the latest candles while keeping the whole range scrollable.
  const start =
    usable.length > MAX_CANDLES
      ? Math.max(0, Math.round(100 - (MAX_CANDLES / usable.length) * 100))
      : 0;

  return {
    ...baseOption(
      t,
      titled("Proxy OHLC from min/max/modal — not traded OHLC", asOf),
      [name],
      (params) => {
        const list = asParams(params);
        const idx = list.find((p) => Number.isInteger(p.dataIndex))?.dataIndex ?? 0;
        const row = usable[idx];
        const candle = candles[idx];
        if (!row || !Array.isArray(candle)) return "";
        const [open, close, low, high] = candle as number[];
        return tooltipShell(row.date, [
          field("Open (prev modal)", formatAgriValue(open, unit)),
          field("High (max)", formatAgriValue(high, unit)),
          field("Low (min)", formatAgriValue(low, unit)),
          field("Close (modal)", formatAgriValue(close, unit)),
          `<div style="opacity:0.7">Proxy only — not traded OHLC</div>`,
        ]);
      },
    ),
    grid: [{ left: 56, right: 24, top: CHART_LAYOUT.gridTop, bottom: CHART_LAYOUT.gridBottomWithZoom, containLabel: true }],
    xAxis: [categoryAxis(dates, t, 0, true)],
    yAxis: [valueAxis(t, 0)],
    dataZoom: makeDataZoom(t, [0], start),
    series: [
      {
        name,
        type: "candlestick",
        data: candles,
        barMaxWidth: 10,
        itemStyle: {
          color: POSITIVE,
          color0: NEGATIVE,
          borderColor: POSITIVE,
          borderColor0: NEGATIVE,
        },
        z: 2,
      },
    ],
  };
}

/**
 * Pure ECharts option builder for the agri redesign. Returns `{}` when there is
 * no drawable data so the caller can render its empty state instead of a blank
 * canvas.
 */
export function buildAgriChartOption(input: AgriChartInput): Record<string, unknown> {
  if (!input) return {};
  const mode: AgriChartMode = input.mode ?? "band";
  const unit = typeof input.unit === "string" && input.unit.trim() !== "" ? input.unit.trim() : DEFAULT_UNIT;
  const asOf = typeof input.asOf === "string" && input.asOf.trim() !== "" ? input.asOf.trim() : undefined;
  const t = themeTokens(input.isDark !== false);
  const source = Array.isArray(input.series) ? input.series : [];
  const rows = asOf ? source.filter((r) => r && typeof r.date === "string" && r.date <= asOf) : source;

  if (mode === "compare") {
    const comparison = Array.isArray(input.comparison) ? input.comparison : [];
    return comparison.length === 0 ? {} : buildCompare(comparison, t, asOf);
  }
  if (rows.length === 0) return {};
  if (mode === "arrivals") return buildArrivals(rows, unit, t, asOf);
  if (mode === "ohlc") return buildOhlc(rows, unit, t, asOf);
  return buildBand(rows, unit, t, asOf);
}
