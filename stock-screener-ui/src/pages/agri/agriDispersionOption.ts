import { AGRI_ACCENT, AGRI_OUTLIER, alpha } from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import {
  asParams,
  baseOption,
  CHART_LAYOUT,
  compactPriceTick,
  escapeHtml,
  field,
  formatAgriValue,
  themeTokens,
  tooltipShell,
  type OptionFragment,
} from "./agriChartTheme";
import type { AgriDispersionRow } from "./agriRedesignData";

export interface AgriDispersionInput {
  rows: readonly AgriDispersionRow[];
  unit: string;
  isDark: boolean;
  compact?: boolean;
}

const DEFAULT_UNIT = "₹/quintal";
const STACK = "agri-mandi-range";
/** A dense mandi list unreadably clips labels; the tooltip keeps every row. */
export const AGRI_DISPERSION_MARKETS = 8;

function niceAxis(min: number, max: number, targetTicks: number): { min: number; max: number; interval: number } {
  const span = Math.max(max - min, 1);
  const raw = span / Math.max(1, targetTicks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  // Nearest nice step, not the ceiling: ceiling-of-span divided 13.3k–17.6k
  // into ₹10k–20k, wasting half the axis on empty space.
  const choices = [1, 2, 5, 10];
  const step = choices.reduce((best, candidate) =>
    Math.abs(Math.log(candidate) - Math.log(normalized)) <
    Math.abs(Math.log(best) - Math.log(normalized))
      ? candidate
      : best,
  ) * magnitude;
  return {
    min: Math.max(0, Math.floor(min / step) * step),
    max: Math.ceil(max / step) * step,
    interval: step,
  };
}

/**
 * Sorted min–modal–max dot plot for the selected commodity's mandis. A pale
 * range bar carries min→max, the dot is the modal, and outliers outside the
 * 1.5×IQR fence get their own ink instead of stretching the price axis.
 */
export function buildAgriDispersionOption(
  input: AgriDispersionInput | null | undefined,
): OptionFragment {
  if (!input || typeof input !== "object") return {};
  const source = (Array.isArray(input.rows) ? input.rows : []).filter(
    (row) => row && typeof row.market === "string",
  );
  if (source.every((row) => row.modal == null)) return {};
  const t = themeTokens(input.isDark !== false);
  const unit = input.unit?.trim() || DEFAULT_UNIT;
  const compact = input.compact === true;
  // Keep the dearest mandis (including high outliers) and reverse for display:
  // ECharts draws category axis 0 at the bottom.
  const rows = [...source]
    .sort((a, b) => {
      const left = a.modal ?? Number.NEGATIVE_INFINITY;
      const right = b.modal ?? Number.NEGATIVE_INFINITY;
      return right === left ? 0 : right > left ? 1 : -1;
    })
    .slice(0, AGRI_DISPERSION_MARKETS)
    .reverse();
  const labels = rows.map((row) => row.label || row.market);
  const floor = rows.map((row) => {
    const min = row.min ?? row.modal;
    return min != null && row.modal != null ? Math.min(min, row.modal) : null;
  });
  const span = rows.map((row, index) => {
    const low = floor[index];
    const max = row.max ?? row.modal;
    return low != null && max != null ? Math.max(0, max - low) : null;
  });
  const modals = rows.map((row, index) => (row.modal == null ? null : [row.modal, index]));
  const outliers = rows
    .map((row, index) => (row.outlier && row.modal != null ? [row.modal, index] : null))
    .filter((value): value is number[] => value != null);
  const prices = rows.flatMap((row) => [row.min, row.modal, row.max].filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 1;
  const pad = Math.max((maxPrice - minPrice) * 0.03, 1);
  const axis = niceAxis(Math.max(0, minPrice - pad), maxPrice + pad, compact ? 3 : 5);
  if (compact) axis.interval = (axis.max - axis.min) / 2;

  const tooltip = (params: unknown): string => {
    const list = asParams(params);
    const index = list.find((param) => Number.isInteger(param.dataIndex))?.dataIndex ?? 0;
    const row = rows[index];
    if (!row) return "";
    return tooltipShell(escapeHtml(row.market), [
      field("Date", row.date),
      field("Modal", formatAgriValue(row.modal, unit)),
      field("Min", formatAgriValue(row.min, unit)),
      field("Max", formatAgriValue(row.max, unit)),
      ...(row.arrivals != null ? [field("Arrivals", `${row.arrivals.toLocaleString("en-IN")} qtl`)] : []),
      ...(row.outlier ? [field("Fence", "outside 1.5×IQR — outlier")] : []),
    ]);
  };

  return {
    ...baseOption(t, "", [], tooltip),
    title: undefined,
    legend: undefined,
    grid: [
      {
        left: compact ? 96 : 124,
        right: compact ? 52 : 76,
        top: 12,
        bottom: CHART_LAYOUT.gridBottom - 28,
        containLabel: true,
      },
    ],
    xAxis: [
      {
        type: "value",
        min: axis.min,
        max: axis.max,
        interval: axis.interval,
        splitNumber: compact ? 3 : 5,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: t.muted,
          fontSize: typeSize("micro"),
          formatter: (value: number) => compactPriceTick(value),
          hideOverlap: true,
        },
        splitLine: { lineStyle: { color: t.split, type: "dashed" } },
      },
    ],
    yAxis: [
      {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: {
          color: t.muted,
          fontSize: typeSize("micro"),
          width: compact ? 88 : 116,
          overflow: "truncate",
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Floor",
        type: "bar",
        stack: STACK,
        data: floor,
        barMaxWidth: compact ? 6 : 9,
        itemStyle: { color: "transparent" },
        silent: true,
        z: 1,
      },
      {
        name: "Min–max",
        type: "bar",
        stack: STACK,
        data: span,
        barMaxWidth: compact ? 10 : 14,
        // A visible rail + stronger fill keeps the range legible behind the dot.
        itemStyle: {
          color: alpha(AGRI_ACCENT, 0.34),
          borderColor: alpha(AGRI_ACCENT, 0.85),
          borderWidth: 1,
        },
        emphasis: { itemStyle: { color: alpha(AGRI_ACCENT, 0.5) } },
        z: 2,
      },
      {
        name: "Modal",
        type: "scatter",
        data: modals,
        symbolSize: compact ? 7 : 9,
        itemStyle: { color: AGRI_ACCENT, borderColor: t.text, borderWidth: 1 },
        z: 6,
      },
      {
        name: "Outlier",
        type: "scatter",
        data: outliers,
        // A halo behind the modal dot: drawing the outlier on top hid every
        // modal (the top-priced mandis are often all outside the fence).
        symbolSize: compact ? 13 : 16,
        itemStyle: { color: alpha(AGRI_OUTLIER, 0.85) },
        silent: true,
        label: { show: false },
        z: 4,
      },
    ],
  };
}
