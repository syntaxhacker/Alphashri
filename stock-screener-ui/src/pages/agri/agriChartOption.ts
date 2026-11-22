import {
  alpha,
  BORDER,
  CHART_CROSSHAIR,
  CHART_DARK_BG,
  CHART_DARK_MUTED,
  CHART_DARK_OVERLAY,
  CHART_DARK_SPLIT,
  CHART_DARK_TEXT,
  CHART_LIGHT_BG,
  CHART_LIGHT_BORDER,
  CHART_LIGHT_MUTED,
  CHART_LIGHT_OVERLAY,
  CHART_LIGHT_SPLIT,
  CHART_LIGHT_TEXT,
  INFO,
  NEGATIVE,
  ORB_AREA,
  POSITIVE,
  PRIMARY,
  SCALE_CYAN,
  SCALE_VIOLET,
} from "@/ui/palette";

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

const DEFAULT_UNIT = "₹/quintal";
const MAX_COMPARE = 5;
const BAND_STACK = "agri-minmax-band";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const COMPARE_COLORS = [PRIMARY, INFO, POSITIVE, SCALE_VIOLET[4], SCALE_CYAN[4]];
const NUMBER_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const INDEX_FMT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type Series = Record<string, unknown>;

interface ThemeTokens {
  bg: string;
  text: string;
  muted: string;
  border: string;
  split: string;
  tooltipBg: string;
  crosshair: string;
}

interface TooltipParam {
  dataIndex?: number;
  seriesName?: string;
  axisValue?: unknown;
  value?: unknown;
  marker?: string;
}

function themeTokens(isDark: boolean): ThemeTokens {
  return isDark
    ? {
        bg: CHART_DARK_BG,
        text: CHART_DARK_TEXT,
        muted: CHART_DARK_MUTED,
        border: BORDER,
        split: CHART_DARK_SPLIT,
        tooltipBg: CHART_DARK_OVERLAY,
        crosshair: CHART_CROSSHAIR,
      }
    : {
        bg: CHART_LIGHT_BG,
        text: CHART_LIGHT_TEXT,
        muted: CHART_LIGHT_MUTED,
        border: CHART_LIGHT_BORDER,
        split: CHART_LIGHT_SPLIT,
        tooltipBg: CHART_LIGHT_OVERLAY,
        crosshair: CHART_CROSSHAIR,
      };
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return finite(value);
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

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${INDEX_FMT.format(value)}%`;
}

function escapeHtml(value: string): string {
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

function asParams(params: unknown): TooltipParam[] {
  if (Array.isArray(params)) return params.filter(isParam);
  return isParam(params) ? [params] : [];
}

function tooltipShell(header: string, rows: string[]): string {
  return `<div style="font-family:monospace;font-size:11px;line-height:1.5">` +
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(header)}</div>` +
    rows.filter((row) => row !== "").join("") +
    `</div>`;
}

function rowTooltip(
  params: unknown,
  rows: AgriChartSeriesPoint[],
  fields: (row: AgriChartSeriesPoint) => string[],
): string {
  const list = asParams(params);
  if (list.length === 0) return "";
  const withIndex = list.find((p) => Number.isInteger(p.dataIndex));
  const row = rows[withIndex?.dataIndex ?? 0];
  if (!row) return "";
  return tooltipShell(row.date, fields(row));
}

function field(label: string, value: string): string {
  return `<div>${escapeHtml(label)}: <b>${value}</b></div>`;
}

function categoryAxis(dates: string[], t: ThemeTokens, gridIndex: number, showLabels: boolean): Series {
  return {
    type: "category",
    gridIndex,
    data: dates,
    boundaryGap: gridIndex === 1,
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: showLabels
      ? { color: t.muted, fontSize: 10, interval: "auto", hideOverlap: true }
      : { show: false },
    splitLine: { show: false },
  };
}

function valueAxis(t: ThemeTokens, gridIndex: number, name?: string): Series {
  return {
    type: "value",
    gridIndex,
    scale: true,
    name,
    nameTextStyle: { color: t.muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10 },
    splitLine: { lineStyle: { color: t.split, type: "dashed" } },
  };
}

function makeDataZoom(t: ThemeTokens, xAxisIndex: number[]): Series[] {
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
      textStyle: { color: t.muted, fontSize: 9 },
    },
  ];
}

function baseOption(
  t: ThemeTokens,
  title: string,
  legend: string[],
  formatter: (params: unknown) => string,
): Record<string, unknown> {
  return {
    animation: false,
    backgroundColor: t.bg,
    title: { text: title, left: "center", top: 2, textStyle: { color: t.text, fontSize: 12 } },
    legend: {
      show: legend.length > 0,
      top: 22,
      data: legend,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: t.muted, fontSize: 10 },
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

function titled(mode: string, asOf?: string): string {
  return asOf ? `${mode} · as of ${asOf}` : mode;
}

function modalSeries(data: (number | null)[], gridIndex: number, yAxisIndex: number): Series {
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
    z: 3,
  };
}

function buildBand(
  rows: AgriChartSeriesPoint[],
  unit: string,
  t: ThemeTokens,
  asOf?: string,
): Record<string, unknown> {
  const dates = rows.map((r) => formatAgriDateLabel(r.date));
  const min = rows.map((r) => finiteOrNull(r.min));
  // The upper stacked series carries only the span so ECharts fills the area
  // between min and max; the tooltip reads the raw values from the source row.
  const span = rows.map((r) => {
    const lo = finite(r.min);
    const hi = finite(r.max);
    return lo == null || hi == null ? null : Math.max(0, hi - lo);
  });

  return {
    ...baseOption(
      t,
      titled("Modal price with min–max band", asOf),
      ["Modal", "Max"],
      (params) =>
        rowTooltip(params, rows, (row) => [
          field("Modal", formatAgriValue(row.modal, unit)),
          field("Min", formatAgriValue(row.min, unit)),
          field("Max", formatAgriValue(row.max, unit)),
          field("Markets", formatAgriValue(row.market_count, "")),
        ]),
    ),
    grid: [{ left: 56, right: 24, top: 48, bottom: 64, containLabel: true }],
    xAxis: [categoryAxis(dates, t, 0, true)],
    yAxis: [valueAxis(t, 0)],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      modalSeries(rows.map((r) => finiteOrNull(r.modal)), 0, 0),
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
        name: "Max",
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
): Record<string, unknown> {
  const dates = rows.map((r) => formatAgriDateLabel(r.date));
  const arrivals = rows.map((r) => finiteOrNull(r.arrivals_qtl));

  return {
    ...baseOption(
      t,
      titled("Modal price & arrivals", asOf),
      ["Modal", "Arrivals"],
      (params) =>
        rowTooltip(params, rows, (row) => [
          field("Modal", formatAgriValue(row.modal, unit)),
          field("Arrivals", `${formatAgriValue(row.arrivals_qtl, "")} qtl`),
          field("Markets", formatAgriValue(row.market_count, "")),
        ]),
    ),
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    grid: [
      { left: 56, right: 56, top: 48, height: "54%", containLabel: true },
      { left: 56, right: 56, top: "72%", height: "15%", containLabel: true },
    ],
    xAxis: [categoryAxis(dates, t, 0, false), categoryAxis(dates, t, 1, true)],
    yAxis: [valueAxis(t, 0), valueAxis(t, 1, "Arrivals (qtl)")],
    dataZoom: makeDataZoom(t, [0, 1]),
    series: [
      modalSeries(rows.map((r) => finiteOrNull(r.modal)), 0, 0),
      {
        name: "Arrivals",
        type: "bar",
        data: arrivals,
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 14,
        // Arrivals are informational volume, never a bullish/bearish signal.
        itemStyle: { color: alpha(INFO, 0.45) },
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
): Record<string, unknown> {
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

  const dates = allDates.filter((date) => date >= commonFirst);
  const labels = uniqueLabels(prepared.map((s) => s.label));
  const series: Series[] = prepared.map((s, i) => {
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
                  label: { formatter: "100", color: t.muted },
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
    const header = formatAgriDateLabel(String(list[0].axisValue ?? dates[0] ?? ""));
    const rows = list.map((p) => {
      const value = finite(typeof p.value === "number" ? p.value : null);
      if (value == null) return "";
      const pct = value - 100;
      return (
        `<div>${p.marker ?? ""}${escapeHtml(p.seriesName ?? "")}: ` +
        `<b>${INDEX_FMT.format(value)}</b> ` +
        `<span style="color:${pct >= 0 ? POSITIVE : NEGATIVE}">${formatPct(pct)}</span></div>`
      );
    });
    return tooltipShell(header, rows);
  };

  return {
    ...baseOption(t, titled("Modal price indexed to 100 at common start", asOf), labels, compareTooltip),
    grid: [{ left: 56, right: 24, top: 48, bottom: 64, containLabel: true }],
    xAxis: [categoryAxis(dates.map(formatAgriDateLabel), t, 0, true)],
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
): Record<string, unknown> {
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
    grid: [{ left: 56, right: 24, top: 48, bottom: 64, containLabel: true }],
    xAxis: [categoryAxis(dates, t, 0, true)],
    yAxis: [valueAxis(t, 0)],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      {
        name,
        type: "candlestick",
        data: candles,
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
