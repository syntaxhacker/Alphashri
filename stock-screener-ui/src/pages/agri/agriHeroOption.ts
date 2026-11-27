import { alpha, AGRI_ACCENT, AGRI_CONTEXT } from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import {
  asParams,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  field,
  finite,
  formatAgriDateLabel,
  formatAgriValue,
  makeDataZoom,
  themeTokens,
  tooltipShell,
  valueAxis,
  type OptionFragment,
} from "./agriChartTheme";
import type { AgriChartSeriesPoint } from "./agriChartOption";

export interface AgriHeroContext {
  key: string;
  label: string;
  points: ReadonlyArray<{ date: string; modal: number | null }>;
}

export interface AgriHeroInput {
  title: string;
  series: readonly AgriChartSeriesPoint[];
  comparison: readonly AgriHeroContext[];
  unit: string;
  isDark: boolean;
  asOf?: string;
  /** Compact label margins for the 390px layout. */
  compact?: boolean;
}

const GAP_BREAK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_UNIT = "₹/quintal";

interface DisplayRow extends AgriChartSeriesPoint {
  gap: boolean;
}

function withGaps(rows: readonly AgriChartSeriesPoint[]): DisplayRow[] {
  const out: DisplayRow[] = [];
  rows.forEach((row, index) => {
    if (index > 0) {
      const previous = rows[index - 1];
      const elapsed = Date.parse(`${row.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`);
      if (elapsed > GAP_BREAK_MS) {
        const marker = new Date(Date.parse(`${previous.date}T00:00:00Z`) + 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        out.push({
          date: marker,
          modal: null,
          min: null,
          max: null,
          arrivals_qtl: null,
          market_count: 0,
          gap: true,
        });
      }
    }
    out.push({ ...row, gap: false } as DisplayRow);
  });
  return out;
}

/**
 * D3-style annotated line: one bold series, muted context, a direct end label
 * and a vertical "as of" rule. No one-colour-per-series legend parade.
 */
export function buildAgriHeroOption(input: AgriHeroInput | null | undefined): OptionFragment {
  if (!input || typeof input !== "object") return {};
  const t = themeTokens(input.isDark !== false);
  const unit = input.unit?.trim() || DEFAULT_UNIT;
  const asOf = typeof input.asOf === "string" && input.asOf.trim() ? input.asOf.trim() : undefined;
  const raw = Array.isArray(input.series) ? input.series : [];
  const filtered = asOf ? raw.filter((row) => row && row.date <= asOf) : raw;
  const rows = withGaps(filtered.filter((row) => row && typeof row.date === "string"));
  if (rows.every((row) => finite(row.modal) == null)) return {};

  const dates = rows.map((row) => (row.gap ? "" : formatAgriDateLabel(row.date)));
  const lastIndex = rows.reduce(
    (found, row, index) => (finite(row.modal) != null ? index : found),
    -1,
  );
  const lastRow = lastIndex >= 0 ? rows[lastIndex] : null;
  const lastValue = lastRow ? finite(lastRow.modal) : null;
  const compact = input.compact === true;
  // The panel header owns the title and the single "How to read" line; the
  // canvas carries only data ink and the direct latest/as-of annotations.
  const title = input.title?.trim() || "Modal price";

  const contextSeries = (Array.isArray(input.comparison) ? input.comparison : [])
    .filter((entry) => entry && typeof entry.key === "string" && Array.isArray(entry.points))
    .slice(0, 3)
    .map((entry) => {
      const byDate = new Map<string, number>();
      for (const point of entry.points) {
        const value = finite(point?.modal);
        if (value != null) byDate.set(point.date, value);
      }
      return {
        label: entry.label || entry.key,
        data: rows.map((row) => (row.gap ? null : (byDate.get(row.date) ?? null))),
      };
    })
    .filter((entry) => entry.data.some((value) => value != null));

  // Scale to what the hero actually draws. The old band bounds pulled the
  // daily min/max edges into a view that never drew the band, pushing the
  // modal (₹5.3k) into the bottom third of an 18k axis.
  const drawn: number[] = [];
  for (const row of rows) {
    const value = finite(row.modal);
    if (value != null) drawn.push(value);
  }
  for (const entry of contextSeries) {
    for (const value of entry.data) {
      if (typeof value === "number" && Number.isFinite(value)) drawn.push(value);
    }
  }
  let yMin: number | undefined;
  let yMax: number | undefined;
  if (drawn.length > 0) {
    const low = Math.min(...drawn);
    const high = Math.max(...drawn);
    const pad = Math.max((high - low) * 0.08, 1);
    yMin = Math.max(0, low - pad);
    yMax = high + pad;
  }

  const tooltip = (params: unknown): string => {
    const list = asParams(params);
    if (list.length === 0) return "";
    const index = list.find((param) => Number.isInteger(param.dataIndex))?.dataIndex ?? 0;
    const row = rows[index];
    if (!row) return "";
    if (row.gap) {
      return tooltipShell("Data gap", [field("Interval", formatAgriDateLabel(row.date))]);
    }
    const fields = [
      field("Modal", formatAgriValue(row.modal, unit)),
      field("Min", formatAgriValue(row.min, unit)),
      field("Max", formatAgriValue(row.max, unit)),
      field("Mandis", formatAgriValue(row.market_count, "")),
    ];
    for (const param of list) {
      const value = finite(typeof param.value === "number" ? param.value : null);
      const name = typeof param.seriesName === "string" ? param.seriesName : "";
      if (value == null || !name || name === title || fields.some((line) => line.includes(name))) {
        continue;
      }
      fields.push(field(name, formatAgriValue(value, unit)));
    }
    return tooltipShell(formatAgriDateLabel(row.date), fields);
  };

  const focus: OptionFragment = {
    name: title,
    type: "line",
    data: rows.map((row) => (row.gap ? null : finite(row.modal))),
    showSymbol: false,
    symbol: "none",
    connectNulls: false,
    lineStyle: { color: AGRI_ACCENT, width: compact ? 2 : 2.5 },
    itemStyle: { color: AGRI_ACCENT },
    // The official ECharts area treatment gives the single focus series a
    // readable silhouette; the fill is a token-derived tint, never a second hue.
    areaStyle: { color: alpha(AGRI_ACCENT, 0.09), origin: "start" },
    z: 6,
    endLabel: {
      show: lastValue != null,
      formatter:
        lastValue == null
          ? ""
          : compact
            ? `₹${Math.round(lastValue).toLocaleString("en-IN")}`
            : formatAgriValue(lastValue, unit),
      color: AGRI_ACCENT,
      fontSize: typeSize("micro"),
      fontWeight: 700,
      distance: 6,
      overflow: "truncate",
      width: compact ? 72 : 100,
    },
    markLine: {
      silent: true,
      symbol: "none",
      data:
        lastIndex >= 0
          ? [
              {
                xAxis: lastIndex,
                lineStyle: { color: alpha(AGRI_ACCENT, 0.55), type: "dashed", width: 1 },
                label: {
                  show: true,
                  formatter: `as of ${formatAgriDateLabel(lastRow?.date ?? "")}`,
                  color: t.muted,
                  fontSize: typeSize("micro"),
                  position: "insideEndTop",
                },
              },
            ]
          : [],
    },
  };

  return {
    ...baseOption(t, "", [], tooltip),
    title: undefined,
    legend: undefined,
    grid: [
      {
        left: compact ? 44 : 56,
        right: compact ? 76 : 104,
        top: 12,
        bottom: CHART_LAYOUT.gridBottomWithZoom - 24,
        containLabel: true,
      },
    ],
    xAxis: [categoryAxis(dates, t, 0, true)],
    yAxis: [
      {
        ...valueAxis(t, 0),
        ...(yMin != null ? { min: yMin } : {}),
        ...(yMax != null ? { max: yMax } : {}),
      },
    ],
    dataZoom: makeDataZoom(t, [0]),
    series: [
      focus,
      ...contextSeries.map((entry, index) => ({
        name: entry.label,
        type: "line",
        data: entry.data,
        showSymbol: false,
        symbol: "none",
        connectNulls: false,
        lineStyle: { color: alpha(AGRI_CONTEXT, index === 0 ? 0.9 : 0.6), width: 1 },
        itemStyle: { color: AGRI_CONTEXT },
        // Direct-label the context series instead of relying on a legend the
        // hero does not carry.
        endLabel: {
          show: true,
          formatter: entry.label,
          color: t.muted,
          fontSize: typeSize("micro"),
          distance: 6,
          overflow: "truncate",
          width: compact ? 60 : 84,
        },
        labelLayout: { moveOverlap: "shiftY" },
        z: 2,
      })),
    ],
  };
}
