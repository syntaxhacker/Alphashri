import { alpha, INFO, NEGATIVE, PRIMARY } from "@/ui/palette";
import {
  asArray,
  baseOption,
  categoryAxis,
  CHART_LAYOUT,
  DEFAULT_UNIT,
  EdaBox,
  EdaDistributionInput,
  field,
  finite,
  formatCount,
  formatValue,
  monthLabel,
  Option,
  paramIndex,
  themeTokens,
  tooltipShell,
  unitOf,
  valueAxis,
} from "./shared";

const IQR_MULTIPLIER = 1.5;

interface PreparedBox {
  source: EdaBox;
  label: string;
  /** [lower whisker, Q1, median, Q3, upper whisker]. */
  box: number[];
  median: number;
  outliers: number[];
}

function whiskersOf(box: EdaBox): { box: number[]; median: number; outliers: number[] } | null {
  const min = finite(box.min);
  const q1 = finite(box.q1) ?? min;
  const median = finite(box.median);
  const q3 = finite(box.q3) ?? finite(box.max);
  const max = finite(box.max);
  if (q1 == null || median == null || q3 == null) return null;
  const iqr = Math.max(0, q3 - q1);
  const lowerWhisker = Math.min(q1, Math.max(min ?? q1, q1 - IQR_MULTIPLIER * iqr));
  const upperWhisker = Math.max(q3, Math.min(max ?? q3, q3 + IQR_MULTIPLIER * iqr));
  const explicit = (Array.isArray(box.outliers) ? box.outliers : [])
    .map((value) => finite(value))
    .filter((value): value is number => value != null);
  // Aggregate boxes only expose min/max, so at most one value can be proven
  // beyond a fence. Never invent observation counts beyond that.
  const outliers = explicit.length > 0
    ? explicit
    : [
        ...(min != null && min < lowerWhisker ? [min] : []),
        ...(max != null && max > upperWhisker ? [max] : []),
      ];
  return { box: [lowerWhisker, q1, median, q3, upperWhisker], median, outliers };
}

/** ECharts boxplot by calendar month with 1.5×IQR whiskers and outliers. */
export function buildDistributionOption(input: EdaDistributionInput | null | undefined): Option {
  if (!input || typeof input !== "object") return {};
  const unit = unitOf(input.unit, DEFAULT_UNIT);
  const t = themeTokens(input.isDark);
  const prepared: PreparedBox[] = [];
  for (const box of asArray<EdaBox>(input.boxes)) {
    const whiskers = whiskersOf(box);
    if (!whiskers) continue;
    prepared.push({
      source: box,
      label: typeof box.label === "string" && box.label.trim() !== "" ? box.label.trim() : monthLabel(box.month),
      ...whiskers,
    });
  }
  if (prepared.length === 0) return {};

  const outlierPoints: number[][] = [];
  prepared.forEach((entry, index) => {
    for (const value of entry.outliers) outlierPoints.push([index, value]);
  });

  const option = baseOption(
    t,
    `Monthly modal-price distribution · ${unit}`,
    outlierPoints.length > 0 ? ["Monthly spread", "Median", "Outliers"] : ["Monthly spread", "Median"],
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
        field("Lower whisker", formatValue(entry.box[0], unit)),
        field("Upper whisker", formatValue(entry.box[4], unit)),
        field("n", formatCount(box.count)),
        ...(entry.outliers.length > 0
          ? [field("Outliers", entry.outliers.map((value) => formatValue(value, unit)).join(", "))]
          : []),
      ]);
    },
  );
  return {
    ...option,
    grid: [{ left: 56, right: 24, top: CHART_LAYOUT.gridTop, bottom: CHART_LAYOUT.gridBottom, containLabel: true }],
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
      ...(outlierPoints.length > 0
        ? [
            {
              name: "Outliers",
              type: "scatter",
              data: outlierPoints,
              symbolSize: 6,
              itemStyle: { color: NEGATIVE },
              z: 6,
            },
          ]
        : []),
    ],
  };
}
