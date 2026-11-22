import { alpha, INFO, PRIMARY } from "@/ui/palette";
import {
  asArray,
  baseOption,
  boxMean,
  categoryAxis,
  CHART_LAYOUT,
  DEFAULT_UNIT,
  EdaBox,
  EdaSeasonalityInput,
  field,
  finite,
  formatCount,
  formatValue,
  MONTHS,
  monthIndex,
  Option,
  paramIndex,
  themeTokens,
  tooltipShell,
  unitOf,
  valueAxis,
} from "./shared";

const WEAK_HISTORY_COUNT = 3;

function emptyMonths(): (number | null)[] {
  return Array.from({ length: MONTHS.length }, () => null);
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
    const years = finite(box.years);
    if (years != null) return years < 2;
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
    weak ? "Weak history — some months have fewer than 2 seasons; read with caution" : undefined,
  );

  return {
    ...option,
    grid: [
      {
        left: 56,
        right: 24,
        top: weak ? CHART_LAYOUT.gridTopWithSubtext : CHART_LAYOUT.gridTop,
        bottom: CHART_LAYOUT.gridBottom,
        containLabel: true,
      },
    ],
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
