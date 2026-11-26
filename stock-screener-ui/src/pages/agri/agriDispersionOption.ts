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
const MAX_MARKETS = 8;

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
    .slice(0, MAX_MARKETS)
    .reverse();
  const labels = rows.map((row) => row.market);
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
  const pad = Math.max((maxPrice - minPrice) * 0.08, 1);

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
        min: Math.max(0, minPrice - pad),
        max: maxPrice + pad,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: t.muted,
          fontSize: typeSize("micro"),
          formatter: (value: number) => compactPriceTick(value),
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
        barMaxWidth: compact ? 6 : 9,
        itemStyle: { color: alpha(AGRI_ACCENT, 0.22) },
        emphasis: { itemStyle: { color: alpha(AGRI_ACCENT, 0.4) } },
        z: 2,
      },
      {
        name: "Modal",
        type: "scatter",
        data: modals,
        symbolSize: compact ? 6 : 8,
        itemStyle: { color: AGRI_ACCENT },
        z: 5,
      },
      {
        name: "Outlier",
        type: "scatter",
        data: outliers,
        symbolSize: compact ? 8 : 10,
        itemStyle: { color: AGRI_OUTLIER },
        label: {
          show: !compact,
          position: "right",
          color: AGRI_OUTLIER,
          fontSize: typeSize("micro"),
          formatter: (param: { value?: unknown }) =>
            Array.isArray(param?.value) && typeof param.value[0] === "number"
              ? formatAgriValue(param.value[0], unit)
              : "",
        },
        z: 6,
      },
    ],
  };
}
