import { alpha, INFO, PRIMARY } from "@/ui/palette";
import {
  asArray,
  asParams,
  baseOption,
  CHART_LAYOUT,
  DEFAULT_ARRIVALS_UNIT,
  DEFAULT_UNIT,
  EdaScatter,
  EdaSupplyDemandInput,
  escapeHtml,
  field,
  finite,
  formatCount,
  formatStat,
  formatValue,
  Option,
  paramIndex,
  themeTokens,
  tooltipShell,
  unitOf,
  valueAxis,
} from "./shared";

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

  const compact = input.compact === true;
  const option = baseOption(
    t,
    compact ? "Arrivals vs price" : `Arrivals vs modal price · ${arrivalsUnit} / ${unit}`,
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
    // The statistics sit below the plot: at the top right they collide with a
    // centered title and with the legend on narrow panels.
    graphic: [
      {
        type: "text",
        right: 16,
        bottom: 12,
        silent: true,
        style: {
          text: `r = ${formatStat(scatter?.pearson)}  ·  R² = ${formatStat(scatter?.r2)}  ·  n = ${formatCount(scatter?.n)}`,
          fill: t.text,
          font: "11px monospace",
        },
      },
    ],
    grid: [
      {
        left: compact ? 52 : 64,
        right: compact ? 28 : 24,
        top: CHART_LAYOUT.gridTop,
        bottom: CHART_LAYOUT.gridBottom,
        containLabel: true,
      },
    ],
    xAxis: [
      {
        ...valueAxis(t, compact ? undefined : `Arrivals (${arrivalsUnit})`),
        splitNumber: compact ? 3 : 5,
        axisLabel: {
          ...(valueAxis(t).axisLabel as Record<string, unknown>),
          hideOverlap: true,
          formatter: compact
            ? (value: number) =>
                Math.abs(value) >= 1_000
                  ? `${Math.round(value / 1_000)}k`
                  : `${Math.round(value)}`
            : (value: number) =>
                Math.abs(value) >= 1_000
                  ? `${(value / 1_000).toFixed(0)}k`
                  : `${Math.round(value)}`,
        },
      },
    ],
    yAxis: [
      {
        ...valueAxis(t, compact ? undefined : unit),
        splitNumber: compact ? 4 : 5,
      },
    ],
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
