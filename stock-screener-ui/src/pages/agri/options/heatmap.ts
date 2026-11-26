import { alpha, BORDER, VIRIDIS_STOPS } from "@/ui/palette";
import { heatmapColumns } from "./heatmap.columns";
import {
  asArray,
  asParams,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  DEFAULT_UNIT,
  EdaHeatmapInput,
  EdaHeatmapRow,
  field,
  finite,
  formatValue,
  MONTHS,
  Option,
  themeTokens,
  tooltipShell,
} from "./shared";

const HEATMAP_MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

function heatmapMonthKey(month: unknown): string | null {
  if (typeof month !== "string") return null;
  const raw = month.trim();
  if (HEATMAP_MONTH_KEY.test(raw)) return raw;
  const loose = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (!loose) return null;
  const index = Number(loose[2]);
  return index >= 1 && index <= 12 ? `${loose[1]}-${String(index).padStart(2, "0")}` : null;
}

function heatmapColumnLabel(key: string): string {
  const parts = /^(\d{4})-(\d{2})$/.exec(key);
  if (!parts) return key;
  const name = MONTHS[Number(parts[2]) - 1];
  return name ? `${name} ${parts[1].slice(2)}` : key;
}

/**
 * Commodity × calendar-month heatmap with a chronological `YYYY-MM` axis.
 * Colour is normalised within each row, so a cheap commodity and an expensive
 * one both show their own high/low months instead of one global price scale.
 */
export function buildHeatmapOption(input: EdaHeatmapInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const t = themeTokens(input.isDark);
  const rows = asArray<EdaHeatmapRow>(input.rows).filter((row) => Array.isArray(row.months));
  if (rows.length === 0) return {};

  const byRow = rows.map((row) => {
    const map = new Map<string, number | null>();
    for (const entry of asArray<EdaHeatmapRow["months"][number]>(row.months)) {
      const key = heatmapMonthKey(entry.month);
      if (key) map.set(key, finite(entry.modal));
    }
    return map;
  });
  const columns = heatmapColumns(byRow);
  if (columns.length === 0) return {};

  const raw: (number | null)[][] = [];
  const ranges: { min: number; max: number }[] = [];
  const filled: number[][] = [];
  const missing: number[][] = [];
  rows.forEach((_, y) => {
    const values = columns.map((column) => byRow[y].get(column) ?? null);
    raw.push(values);
    const finiteValues = values.filter((value): value is number => value != null);
    const min = finiteValues.length > 0 ? Math.min(...finiteValues) : 0;
    const max = finiteValues.length > 0 ? Math.max(...finiteValues) : 0;
    ranges.push({ min, max });
    values.forEach((value, x) => {
      if (value == null) {
        missing.push([x, y, 0]);
        return;
      }
      // A constant row has no internal spread; 0.5 keeps it mid-ramp.
      filled.push([x, y, max > min ? (value - min) / (max - min) : 0.5]);
    });
  });
  if (filled.length === 0) return {};

  const labels = rows.map((row, i) =>
    typeof row.label === "string" && row.label.trim() !== "" ? row.label.trim() : row.key || `Series ${i + 1}`,
  );
  const option = baseOption(
    t,
    `Modal-price heatmap · row-relative colour · ${DEFAULT_UNIT}`,
    [],
    (params) => {
      const param = asParams(params)[0];
      const value = Array.isArray(param?.value) ? param.value : [];
      const x = finite(typeof value[0] === "number" ? value[0] : null);
      const y = finite(typeof value[1] === "number" ? value[1] : null);
      if (x == null || y == null) return "";
      const column = columns[x];
      const modal = raw[y]?.[x] ?? null;
      const header = `${labels[y] ?? "—"} · ${column ?? "—"}`;
      if (modal == null) return tooltipShell(header, [field("Modal price", "No data")]);
      const range = ranges[y];
      const position = range.max > range.min ? Math.round(((modal - range.min) / (range.max - range.min)) * 100) : 50;
      return tooltipShell(header, [
        field("Modal price", formatValue(modal, DEFAULT_UNIT)),
        field("Row range", `${formatValue(range.min, DEFAULT_UNIT)} – ${formatValue(range.max, DEFAULT_UNIT)}`),
        field("Row position", `${position}%`),
      ]);
    },
    "Colour = position within each commodity's own range; blank cells have no data",
    "item",
  );

  return {
    ...option,
    grid: [
      {
        left: 56,
        right: 24,
        top: CHART_LAYOUT.gridTopWithSubtext,
        // Keep the horizontal visualMap clear of the month labels; sharing a
        // line made "Row low / Row high" collide with the last x tick.
        bottom: CHART_LAYOUT.gridBottomHeatmap + 28,
        containLabel: true,
      },
    ],
    visualMap: [
      {
        min: 0,
        max: 1,
        seriesIndex: 0,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 6,
        // ECharts rotates the horizontal visualMap group, so these are the
        // pre-rotation axes: itemHeight becomes the bar length on screen.
        itemWidth: 12,
        itemHeight: 120,
        text: ["Row high", "Row low"],
        textStyle: { color: t.muted, fontSize: CHART_LAYOUT.font },
        inRange: { color: [...VIRIDIS_STOPS] },
      },
      {
        // ECharts requires a visualMap for every heatmap series; the no-data
        // series is a single muted tint, so its map stays hidden.
        show: false,
        min: 0,
        max: 1,
        seriesIndex: 1,
        inRange: { color: [alpha(t.muted, 0.1), alpha(t.muted, 0.1)] },
      },
    ],
    xAxis: [categoryAxis(columns.map(heatmapColumnLabel), t, { interval: "auto", rotate: columns.length > 18 ? 45 : 0 })],
    yAxis: [categoryAxis(labels, t, { width: 88 })],
    series: [
      {
        name: "Modal price",
        type: "heatmap",
        data: filled,
        label: { show: false },
        itemStyle: { borderColor: BORDER, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.text, borderWidth: 2 } },
      },
      {
        name: "No data",
        type: "heatmap",
        data: missing,
        label: { show: false },
        itemStyle: { color: alpha(t.muted, 0.1), borderColor: t.border, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.text, borderWidth: 2 } },
        z: 0,
      },
    ],
  };
}
