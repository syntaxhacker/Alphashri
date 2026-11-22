import {
  alpha,
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
  INFO,
  PRIMARY,
  VIRIDIS_STOPS,
} from "@/ui/palette";

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
}

export interface EdaSupplyDemandInput {
  scatter?: EdaScatter | null;
  unit?: string;
  arrivalsUnit?: string;
  isDark?: boolean;
}

export interface EdaHeatmapInput {
  rows?: EdaHeatmapRow[] | null;
  isDark?: boolean;
}

export interface EdaRollingInput {
  series?: EdaSeriesPoint[] | null;
  rolling?: number;
  isDark?: boolean;
}

export interface EdaSeasonalityInput {
  seasonality?: EdaBox[] | null;
  unit?: string;
  isDark?: boolean;
}

export type EdaOptionInput =
  | EdaDistributionInput
  | EdaSupplyDemandInput
  | EdaHeatmapInput
  | EdaRollingInput
  | EdaSeasonalityInput;

type Option = Record<string, unknown>;
type Series = Record<string, unknown>;
type Formatter = (params: unknown) => string;

interface ThemeTokens {
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

const DEFAULT_UNIT = "₹/quintal";
const DEFAULT_ARRIVALS_UNIT = "qtl";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEAK_HISTORY_COUNT = 3;
const NUMBER_FMT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const STAT_FMT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unitOf(value: string | null | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function formatValue(value: number | null | undefined, unit: string = DEFAULT_UNIT): string {
  const n = finite(value);
  return n == null ? "—" : `${NUMBER_FMT.format(n)}${unit ? ` ${unit}` : ""}`;
}

function formatCount(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? "—" : NUMBER_FMT.format(n);
}

function formatStat(value: number | null | undefined): string {
  const n = finite(value);
  return n == null ? "—" : STAT_FMT.format(n);
}

function boxMean(box: EdaBox): number | null {
  return finite(box.mean) ?? finite(box.avg);
}

function asArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is T => typeof entry === "object" && entry !== null);
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
  return "<div style=\"font-family:monospace;font-size:11px;line-height:1.5\">" +
    `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(header)}</div>` +
    rows.filter((row) => row !== "").join("") +
    "</div>";
}

function field(label: string, value: string): string {
  return `<div>${escapeHtml(label)}: <b>${value}</b></div>`;
}

function paramIndex(params: unknown): number {
  const found = asParams(params).find((p) => Number.isInteger(p.dataIndex));
  return found?.dataIndex ?? -1;
}

function themeTokens(isDark: boolean | undefined): ThemeTokens {
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

function baseOption(
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
      top: 2,
      textStyle: { color: t.text, fontSize: 12 },
      subtextStyle: { color: t.muted, fontSize: 10 },
    },
    legend: {
      show: legend.length > 0,
      top: subtext ? 38 : 22,
      data: legend,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: t.muted, fontSize: 10 },
    },
    tooltip: {
      trigger,
      axisPointer: { type: "cross", lineStyle: { color: t.crosshair } },
      backgroundColor: t.tooltipBg,
      borderColor: t.border,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 11 },
      formatter,
    },
  };
}

function compactAxisLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${STAT_FMT.format(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${STAT_FMT.format(value / 1_000)}k`;
  return NUMBER_FMT.format(value);
}

function valueAxis(t: ThemeTokens, name?: string): Series {
  return {
    type: "value",
    scale: true,
    name,
    nameTextStyle: { color: t.muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 10, formatter: (value: number) => compactAxisLabel(value) },
    splitLine: { lineStyle: { color: t.split, type: "dashed" } },
  };
}

function categoryAxis(
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
          fontSize: 10,
          interval: opts.interval ?? "auto",
          hideOverlap: true,
          rotate: opts.rotate ?? 0,
          margin: 8,
          width: opts.width,
          overflow: "truncate",
        }
      : { show: false },
    splitLine: { show: false },
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
      textStyle: { color: t.muted, fontSize: 10 },
    },
  ];
}

function monthIndex(month: unknown): number {
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

function monthLabel(month: unknown): string {
  const index = monthIndex(month);
  if (index >= 0) return MONTHS[index];
  return typeof month === "string" && month.trim() !== "" ? month.trim().slice(0, 10) : "—";
}

function formatDateLabel(date: unknown): string {
  if (typeof date !== "string") return "";
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (day) {
    const month = MONTHS[Number(day[2]) - 1];
    return month ? `${day[3]} ${month}` : date;
  }
  return /^\d{4}-\d{2}$/.test(date) ? date : date.slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptyMonths(): (number | null)[] {
  return Array.from({ length: MONTHS.length }, () => null);
}

/** ECharts boxplot by calendar month, with an explicit median line. */
export function buildDistributionOption(input: EdaDistributionInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const unit = unitOf(input.unit, DEFAULT_UNIT);
  const t = themeTokens(input.isDark);
  const prepared = asArray<EdaBox>(input.boxes)
    .map((box) => ({
      source: box,
      label: typeof box.label === "string" && box.label.trim() !== "" ? box.label.trim() : monthLabel(box.month),
      box: [finite(box.min), finite(box.q1), finite(box.median), finite(box.q3), finite(box.max)],
      median: finite(box.median),
    }))
    .filter((entry) => entry.median != null);
  if (prepared.length === 0) return {};

  const option = baseOption(
    t,
    `Monthly modal-price distribution · ${unit}`,
    ["Monthly spread", "Median"],
    (params) => {
      const index = paramIndex(params);
      const entry = prepared[index];
      if (!entry) return "";
      const box = entry.source;
      return tooltipShell(entry.label, [
        field("Min", formatValue(box.min, unit)),
        field("Q1", formatValue(box.q1, unit)),
        field("Median", formatValue(box.median, unit)),
        field("Q3", formatValue(box.q3, unit)),
        field("Max", formatValue(box.max, unit)),
        field("Observations", formatCount(box.count)),
      ]);
    },
  );
  return {
    ...option,
    grid: [{ left: 56, right: 24, top: 48, bottom: 56, containLabel: true }],
    xAxis: [categoryAxis(prepared.map((entry) => entry.label), t, { interval: 0 })],
    yAxis: [valueAxis(t, unit)],
    series: [
      {
        name: "Monthly spread",
        type: "boxplot",
        data: prepared.map((entry) => entry.box),
        itemStyle: { color: alpha(INFO, 0.22), borderColor: INFO, borderWidth: 1.5 },
      },
      {
        name: "Median",
        type: "line",
        data: prepared.map((entry) => entry.median),
        showSymbol: true,
        symbol: "circle",
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { color: PRIMARY, width: 2 },
        itemStyle: { color: PRIMARY },
        z: 5,
      },
    ],
  };
}

/** Arrivals (qtl) against modal price (₹/quintal) with the fitted regression line. */
export function buildSupplyDemandOption(input: EdaSupplyDemandInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const unit = unitOf(input.unit, DEFAULT_UNIT);
  const arrivalsUnit = unitOf(input.arrivalsUnit, DEFAULT_ARRIVALS_UNIT);
  const t = themeTokens(input.isDark);
  const scatter = input.scatter;
  const prepared = asArray<EdaScatter["points"][number]>(scatter?.points)
    .map((point) => ({
      date: typeof point.date === "string" ? point.date : "",
      x: finite(point.arrivals_qtl),
      y: finite(point.modal),
      lagged: finite(point.laggedModal),
    }))
    .filter((point) => point.x != null && point.y != null);
  if (prepared.length === 0) return {};

  const xs = prepared.map((point) => point.x as number);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const slope = finite(scatter?.slope);
  const intercept = finite(scatter?.intercept);
  let regression: number[][] | null = null;
  if (slope != null && intercept != null) {
    const x0 = minX === maxX ? minX - 1 : minX;
    const x1 = minX === maxX ? maxX + 1 : maxX;
    const y0 = slope * x0 + intercept;
    const y1 = slope * x1 + intercept;
    if (Number.isFinite(y0) && Number.isFinite(y1)) {
      regression = [[x0, y0], [x1, y1]];
    }
  }

  const option = baseOption(
    t,
    `Arrivals vs modal price · ${arrivalsUnit} / ${unit}`,
    regression ? ["Observations", "Regression fit"] : ["Observations"],
    (params) => {
      const param = asParams(params)[0];
      if (!param) return "";
      const raw = Array.isArray(param.value) ? param.value : [];
      const x = finite(typeof raw[0] === "number" ? raw[0] : null);
      const y = finite(typeof raw[1] === "number" ? raw[1] : null);
      const point = prepared[paramIndex(params)];
      return tooltipShell(point?.date || "Arrivals vs modal price", [
        field("Date", point?.date ? escapeHtml(point.date) : "—"),
        field("Arrivals", formatValue(x ?? point?.x, arrivalsUnit)),
        field("Modal price", formatValue(y ?? point?.y, unit)),
        ...(point && point.lagged != null ? [field("Lagged modal", formatValue(point.lagged, unit))] : []),
      ]);
    },
    undefined,
    "item",
  );

  return {
    ...option,
    graphic: [
      {
        type: "text",
        right: 16,
        top: 8,
        silent: true,
        style: {
          text: `r = ${formatStat(scatter?.pearson)}  ·  R² = ${formatStat(scatter?.r2)}  ·  n = ${formatCount(scatter?.n)}`,
          fill: t.text,
          font: "11px monospace",
        },
      },
    ],
    grid: [{ left: 64, right: 24, top: 48, bottom: 56, containLabel: true }],
    xAxis: [valueAxis(t, `Arrivals (${arrivalsUnit})`)],
    yAxis: [valueAxis(t, unit)],
    series: [
      {
        name: "Observations",
        type: "scatter",
        data: prepared.map((point) => [point.x, point.y]),
        symbolSize: 8,
        itemStyle: { color: alpha(INFO, 0.8) },
        z: 3,
      },
      ...(regression
        ? [
            {
              name: "Regression fit",
              type: "line",
              data: regression,
              showSymbol: false,
              symbol: "none",
              lineStyle: { color: PRIMARY, width: 2 },
              itemStyle: { color: PRIMARY },
              z: 4,
            },
          ]
        : []),
    ],
  };
}

/** Commodity × calendar-month modal-price heatmap; missing months stay blank. */
export function buildHeatmapOption(input: EdaHeatmapInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const t = themeTokens(input.isDark);
  const rows = asArray<EdaHeatmapRow>(input.rows).filter((row) => Array.isArray(row.months));
  if (rows.length === 0) return {};

  const data: (number | null)[][] = [];
  const values: number[] = [];
  rows.forEach((row, y) => {
    const byMonth = emptyMonths();
    for (const entry of asArray<EdaHeatmapRow["months"][number]>(row.months)) {
      const index = monthIndex(entry.month);
      if (index >= 0) byMonth[index] = finite(entry.modal);
    }
    for (let x = 0; x < 12; x += 1) {
      const value = byMonth[x];
      if (value != null) values.push(value);
      data.push([x, y, value]);
    }
  });
  if (values.length === 0) return {};

  const labels = rows.map((row, i) =>
    typeof row.label === "string" && row.label.trim() !== "" ? row.label.trim() : row.key || `Series ${i + 1}`,
  );
  const option = baseOption(
    t,
    `Modal-price heatmap · ${DEFAULT_UNIT}`,
    [],
    (params) => {
      const param = asParams(params)[0];
      const value = Array.isArray(param?.value) ? param.value : [];
      const x = finite(typeof value[0] === "number" ? value[0] : null);
      const y = finite(typeof value[1] === "number" ? value[1] : null);
      const modal = finite(typeof value[2] === "number" ? value[2] : null);
      if (x == null || y == null) return "";
      return tooltipShell(`${labels[y] ?? "—"} · ${MONTHS[x] ?? "—"}`, [
        field("Modal price", formatValue(modal, DEFAULT_UNIT)),
      ]);
    },
    undefined,
    "item",
  );

  return {
    ...option,
    grid: [{ left: 56, right: 24, top: 48, bottom: 72, containLabel: true }],
    visualMap: {
      min: Math.min(...values),
      max: Math.max(...values),
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      itemWidth: 12,
      itemHeight: 100,
      text: ["High", "Low"],
      textStyle: { color: t.muted, fontSize: 10 },
      inRange: { color: [...VIRIDIS_STOPS] },
    },
    xAxis: [categoryAxis(MONTHS, t, { interval: 0 })],
    yAxis: [categoryAxis(labels, t, { width: 88 })],
    series: [
      {
        name: "Modal price",
        type: "heatmap",
        data,
        label: { show: false },
        itemStyle: { borderColor: BORDER, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.text, borderWidth: 2 } },
      },
    ],
  };
}

/** Modal line, trailing mean and a mean ± 1σ band, with zoom. */
export function buildRollingOption(input: EdaRollingInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const t = themeTokens(input.isDark);
  const points = asArray<EdaSeriesPoint>(input.series)
    .map((point) => ({ date: point.date, modal: finite(point.modal) }))
    .filter((point) => point.modal != null);
  if (points.length === 0) return {};

  const requested = Math.floor(finite(input.rolling) ?? 7);
  const window = Math.max(2, Math.min(requested > 0 ? requested : 7, points.length));
  const means: (number | null)[] = [];
  const lowers: (number | null)[] = [];
  const spans: (number | null)[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const values: number[] = [];
    for (let j = Math.max(0, i - window + 1); j <= i; j += 1) {
      const value = finite(points[j].modal);
      if (value != null) values.push(value);
    }
    if (values.length < 2) {
      means.push(null);
      lowers.push(null);
      spans.push(null);
      continue;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const sd = Math.sqrt(variance);
    means.push(round2(mean));
    lowers.push(round2(mean - sd));
    spans.push(round2(2 * sd));
  }

  const option = baseOption(
    t,
    `Modal price with ${window}-observation rolling band · ${DEFAULT_UNIT}`,
    ["Modal", `Rolling mean (${window})`, "Lower band", "Upper band"],
    (params) => {
      const index = paramIndex(params);
      const point = points[index];
      if (!point) return "";
      const lower = lowers[index];
      const span = spans[index];
      const upper = lower != null && span != null ? round2(lower + span) : null;
      return tooltipShell(formatDateLabel(point.date), [
        field("Modal", formatValue(point.modal, DEFAULT_UNIT)),
        field(`Rolling mean (${window})`, formatValue(means[index], DEFAULT_UNIT)),
        field("Lower band", formatValue(lower, DEFAULT_UNIT)),
        field("Upper band", formatValue(upper, DEFAULT_UNIT)),
      ]);
    },
  );

  return {
    ...option,
    grid: [{ left: 56, right: 24, top: 48, bottom: 64, containLabel: true }],
    xAxis: [categoryAxis(points.map((point) => formatDateLabel(point.date)), t)],
    yAxis: [valueAxis(t, DEFAULT_UNIT)],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      {
        name: "Modal",
        type: "line",
        data: points.map((point) => point.modal),
        showSymbol: false,
        symbol: "none",
        lineStyle: { color: PRIMARY, width: 2 },
        itemStyle: { color: PRIMARY },
        z: 5,
      },
      {
        name: `Rolling mean (${window})`,
        type: "line",
        data: means,
        showSymbol: false,
        symbol: "none",
        connectNulls: false,
        lineStyle: { color: INFO, width: 2, type: "dashed" },
        itemStyle: { color: INFO },
        z: 4,
      },
      // The band is stacked: the lower leg is invisible and the upper leg draws
      // only the span, so ECharts fills the region between the two bounds.
      {
        name: "Lower band",
        type: "line",
        stack: "agri-rolling-band",
        data: lowers,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: alpha(INFO, 0) },
        silent: true,
        z: 1,
      },
      {
        name: "Upper band",
        type: "line",
        stack: "agri-rolling-band",
        data: spans,
        showSymbol: false,
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: alpha(INFO, 0.15) },
        silent: true,
        z: 2,
      },
    ],
  };
}

/** Month-of-year central tendency with an explicit weak-history warning. */
export function buildSeasonalityOption(input: EdaSeasonalityInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const unit = unitOf(input.unit, DEFAULT_UNIT);
  const t = themeTokens(input.isDark);
  const byMonth = new Map<number, EdaBox>();
  for (const box of asArray<EdaBox>(input.seasonality)) {
    const index = monthIndex(box.month);
    if (index >= 0 && finite(box.median) != null) byMonth.set(index, box);
  }
  const observed = [...byMonth.entries()].sort((a, b) => a[0] - b[0]);
  if (observed.length === 0) return {};

  const weak = observed.some(([, box]) => {
    const count = finite(box.count);
    return count != null && count < WEAK_HISTORY_COUNT;
  });
  const medians = emptyMonths();
  const means = emptyMonths();
  for (const [index, box] of observed) {
    medians[index] = finite(box.median);
    means[index] = boxMean(box);
  }
  const option = baseOption(
    t,
    `Seasonality — modal price by month · ${unit}`,
    ["Median", "Mean"],
    (params) => {
      const index = paramIndex(params);
      const box = byMonth.get(index);
      if (!box) return "";
      return tooltipShell(MONTHS[index], [
        field("Median", formatValue(box.median, unit)),
        field("Mean", formatValue(boxMean(box), unit)),
        field("Min", formatValue(box.min, unit)),
        field("Max", formatValue(box.max, unit)),
        field("Observations", formatCount(box.count)),
      ]);
    },
    weak ? "Weak history — some months have fewer than 3 seasons; read with caution" : undefined,
  );

  return {
    ...option,
    grid: [{ left: 56, right: 24, top: weak ? 52 : 48, bottom: 56, containLabel: true }],
    xAxis: [categoryAxis(MONTHS, t, { interval: 0 })],
    yAxis: [valueAxis(t, unit)],
    series: [
      {
        name: "Median",
        type: "bar",
        data: medians,
        barMaxWidth: 20,
        itemStyle: { color: alpha(INFO, 0.6) },
        z: 2,
      },
      {
        name: "Mean",
        type: "line",
        data: means,
        showSymbol: true,
        symbol: "circle",
        symbolSize: 5,
        connectNulls: false,
        lineStyle: { color: PRIMARY, width: 2 },
        itemStyle: { color: PRIMARY },
        z: 3,
      },
    ],
  };
}

function normalizeMode(mode: unknown): EdaMode | "" {
  if (typeof mode !== "string") return "";
  const key = mode.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (key === "distribution" || key === "boxplot" || key === "box") return "distribution";
  if (key === "supply-demand" || key === "supplydemand" || key === "scatter" || key === "regression") {
    return "supplyDemand";
  }
  if (key === "heatmap" || key === "heat") return "heatmap";
  if (key === "rolling" || key === "trend") return "rolling";
  if (key === "seasonality" || key === "seasonal" || key === "season") return "seasonality";
  return "";
}

/** Dispatch an EDA view to its pure option builder. Unknown modes return `{}`. */
export function buildEdaOption(
  mode: EdaMode | string | null | undefined,
  input: EdaOptionInput | null | undefined,
): Option {
  if (!input || typeof input !== "object") return {};
  switch (normalizeMode(mode)) {
    case "distribution":
      return buildDistributionOption(input as EdaDistributionInput);
    case "supplyDemand":
      return buildSupplyDemandOption(input as EdaSupplyDemandInput);
    case "heatmap":
      return buildHeatmapOption(input as EdaHeatmapInput);
    case "rolling":
      return buildRollingOption(input as EdaRollingInput);
    case "seasonality":
      return buildSeasonalityOption(input as EdaSeasonalityInput);
    default:
      return {};
  }
}
