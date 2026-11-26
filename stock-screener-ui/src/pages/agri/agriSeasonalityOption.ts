import { AGRI_SEASON_STOPS, BORDER } from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import { pickTextColor } from "@/utils/contrast";
import {
  asParams,
  baseOption,
  categoryAxis,
  field,
  formatAgriValue,
  themeTokens,
  tooltipShell,
  type OptionFragment,
} from "./agriChartTheme";
import type { AgriSeasonCell, AgriSeasonRow } from "./agriRedesignData";

export interface AgriSeasonalityInput {
  rows: readonly AgriSeasonRow[];
  unit: string;
  isDark: boolean;
  compact?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_UNIT = "₹/quintal";
const SCALE_LIMIT = 20;

function stopFor(pct: number): string {
  const position = Math.max(0, Math.min(1, (pct + SCALE_LIMIT) / (2 * SCALE_LIMIT)));
  const scaled = position * (AGRI_SEASON_STOPS.length - 1);
  const low = Math.floor(scaled);
  const high = Math.ceil(scaled);
  return AGRI_SEASON_STOPS[low === high ? low : high];
}

/** Plain number for tooltips; the cell label carries the percent unit. */
function valueFor(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function cellLabel(pct: number): string {
  const plain = valueFor(pct);
  return plain === "0" ? "0%" : `${plain}%`;
}

/**
 * Commodity × month heatmap. Colour encodes deviation from that commodity's
 * own observed-month average, so a cheap and an expensive commodity share one
 * diverging scale; the axes carry the labels, not a legend paragraph.
 */
export function buildAgriSeasonalityOption(
  input: AgriSeasonalityInput | null | undefined,
): OptionFragment {
  if (!input || typeof input !== "object") return {};
  const source: readonly AgriSeasonRow[] = Array.isArray(input.rows)
    ? (input.rows as AgriSeasonRow[])
    : [];
  const rows = source.filter((row) => row && Array.isArray(row.cells) && row.cells.length > 0);
  if (rows.length === 0) return {};
  const t = themeTokens(input.isDark !== false);
  const unit = input.unit?.trim() || DEFAULT_UNIT;
  const compact = input.compact === true;

  const lookup = new Map<string, Map<number, AgriSeasonCell>>();
  rows.forEach((row) => {
    lookup.set(row.key, new Map(row.cells.map((cell) => [cell.month, cell])));
  });
  const data: Array<Record<string, unknown>> = [];
  rows.forEach((row, rowIndex) => {
    for (const cell of row.cells) {
      const fill = stopFor(cell.pct);
      const actual = Math.round(cell.pct * 10) / 10;
      // Dimension 2 is the honest value shown in the label/tooltip; dimension
      // 3 is clamped for visualMap only. Without this a series whose monthly
      // deviations exceed the 20% scale (Onion) silently loses every cell.
      const clamped = Math.max(-SCALE_LIMIT, Math.min(SCALE_LIMIT, actual));
      data.push({
        value: [cell.month - 1, rowIndex, actual, clamped],
        label: { color: pickTextColor(fill), formatter: cellLabel(cell.pct) },
      });
    }
  });
  if (data.length === 0) return {};

  const tooltip = (params: unknown): string => {
    const param = asParams(params)[0];
    const value = Array.isArray(param?.value) ? param.value : [];
    const month = typeof value[0] === "number" ? value[0] + 1 : null;
    const rowIndex = typeof value[1] === "number" ? value[1] : null;
    if (month == null || rowIndex == null) return "";
    const row = rows[rowIndex];
    const cell = row ? lookup.get(row.key)?.get(month) : undefined;
    if (!row || !cell) return "";
    return tooltipShell(`${row.label} · ${MONTHS[month - 1] ?? month}`, [
      field("Modal", formatAgriValue(cell.avg, unit)),
      field("vs own average", `${valueFor(cell.pct)}%`),
      field("Observations", String(cell.count)),
      field("Distinct years", String(cell.years)),
    ]);
  };

  const base = baseOption(t, "", [], tooltip);
  return {
    ...base,
    title: undefined,
    legend: undefined,
    // A heatmap cell is a single item: an axis trigger would read the first
    // row in the hovered month and mislabel Tomato/Wheat as Onion.
    tooltip: { ...(base.tooltip as Record<string, unknown>), trigger: "item" },
    grid: [
      {
        left: compact ? 52 : 84,
        right: compact ? 8 : 14,
        top: 8,
        bottom: 58,
        containLabel: true,
      },
    ],
    // ECharts heatmap requires category axes with boundaryGap on both sides;
    // categoryAxis() defaults grid 0 to false for line series.
    xAxis: [
      {
        ...categoryAxis(MONTHS, t, 0, true),
        boundaryGap: true,
        // Three-letter months, wrapped rather than overlapping in narrow cells.
        axisLabel: {
          color: t.muted,
          fontSize: typeSize("micro"),
          // Twelve three-letter months merge into one run at 390; keep every
          // cell but label alternate months so the ticks stay scannable.
          interval: compact ? 1 : 0,
          width: compact ? 26 : 28,
          overflow: "break",
          lineHeight: 12,
        },
      },
    ],
    yAxis: [
      {
        type: "category",
        data: rows.map((row) => row.label),
        boundaryGap: true,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: typeSize("micro"), width: compact ? 56 : 84, overflow: "truncate" },
        splitLine: { show: false },
      },
    ],
    visualMap: [
      {
        min: -SCALE_LIMIT,
        max: SCALE_LIMIT,
        dimension: 3,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        splitNumber: 3,
        precision: 0,
        itemWidth: compact ? 54 : 80,
        itemHeight: 8,
        textGap: 6,
        text: [`+${SCALE_LIMIT}%`, `−${SCALE_LIMIT}%`],
        textStyle: { color: t.muted, fontSize: typeSize("micro") },
        inRange: { color: [...AGRI_SEASON_STOPS] },
        // Defensive: the clamped dimension should never hit this, but a
        // future caller passing an unclamped value must not paint nothing.
        outOfRange: { color: [AGRI_SEASON_STOPS[0], AGRI_SEASON_STOPS[6]] },
      },
    ],
    series: [
      {
        name: "Deviation",
        type: "heatmap",
        data,
        label: {
          show: true,
          fontSize: typeSize("micro"),
          fontWeight: 700,
          formatter: (param: { value?: unknown }) => {
            const value = Array.isArray(param?.value) ? param.value[2] : null;
            return typeof value === "number" ? cellLabel(value) : "";
          },
        },
        labelLayout: { hideOverlap: true },
        itemStyle: { borderColor: BORDER, borderWidth: 1 },
        emphasis: { itemStyle: { borderColor: t.text, borderWidth: 2 } },
      },
    ],
  };
}
