import { AGRI_ACCENT, AGRI_CATEGORICAL, AGRI_CONTEXT, alpha } from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import {
  asParams,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  escapeHtml,
  themeTokens,
  tooltipShell,
  type OptionFragment,
} from "./agriChartTheme";
import type { AgriRankSeries } from "./agriRedesignData";

export interface AgriRankInput {
  rows: readonly AgriRankSeries[];
  selected: string;
  isDark: boolean;
  compact?: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string): string {
  const parts = /^(\d{4})-(\d{2})$/.exec(key);
  if (!parts) return key;
  const name = MONTHS[Number(parts[2]) - 1];
  return name ? `${name} ${parts[1].slice(2)}` : key;
}

/** D3-style bump board: rank 1 at the top, direct end labels, selected ink. */
export function buildAgriRankOption(input: AgriRankInput | null | undefined): OptionFragment {
  if (!input || typeof input !== "object") return {};
  const rows = (Array.isArray(input.rows) ? input.rows : []).filter((row) => row && row.key);
  const months = rows[0]?.months ?? [];
  if (rows.length < 2 || months.length < 2) return {};

  const t = themeTokens(input.isDark !== false);
  const compact = input.compact === true;
  const selected = input.selected;
  const hasSelected = rows.some((row) => row.key === selected);

  const tooltip = (params: unknown): string => {
    const list = asParams(params);
    const index = list.find((param) => Number.isInteger(param.dataIndex))?.dataIndex ?? 0;
    const month = months[index];
    if (!month) return "";
    const lines = rows.map((row) => {
      const rank = row.ranks[index];
      if (rank == null) return "";
      return (
        `<div>${escapeHtml(row.label)}: <b>#${rank}</b>` +
        (row.modal != null ? ` · ₹${Math.round(row.modal).toLocaleString("en-IN")}` : "") +
        `</div>`
      );
    });
    return tooltipShell(monthLabel(month), lines);
  };

  return {
    ...baseOption(
      t,
      "Monthly price rank · 1 = highest modal",
      [],
      tooltip,
      "Each line is one commodity's rank inside months where it has a price; gaps are not last place",
    ),
    legend: { show: false },
    grid: [
      {
        left: compact ? 28 : 40,
        right: compact ? 64 : 92,
        top: CHART_LAYOUT.gridTopWithSubtext,
        bottom: CHART_LAYOUT.gridBottom,
        containLabel: true,
      },
    ],
    xAxis: [categoryAxis(months.map(monthLabel), t, 0, true)],
    yAxis: [
      {
        type: "value",
        inverse: true,
        min: 1,
        max: rows.length,
        interval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: t.muted,
          fontSize: typeSize("micro"),
          formatter: (value: number) => `#${value}`,
        },
        splitLine: { lineStyle: { color: t.split, type: "dashed" } },
      },
    ],
    series: rows.map((row, index) => {
      const isSelected = hasSelected && row.key === selected;
      const colour = isSelected
        ? AGRI_ACCENT
        : alpha(AGRI_CATEGORICAL[index % AGRI_CATEGORICAL.length], 0.6);
      return {
        name: row.label,
        type: "line",
        data: [...row.ranks],
        smooth: 0.25,
        connectNulls: false,
        showSymbol: !compact,
        symbol: "circle",
        symbolSize: isSelected ? 7 : 4,
        lineStyle: { color: colour, width: isSelected ? 3 : 1.5 },
        itemStyle: { color: isSelected ? AGRI_ACCENT : AGRI_CONTEXT },
        z: isSelected ? 6 : 3,
        endLabel: {
          show: true,
          formatter: row.label,
          color: isSelected ? AGRI_ACCENT : t.muted,
          fontSize: typeSize("micro"),
          fontWeight: isSelected ? 700 : 400,
          distance: 6,
        },
      };
    }),
  };
}
