import type { HeatmapStock } from "../../api/heatmap";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
} from "../../config/colors";
import {
  METRICS,
  formatMarketCap,
  getHeatmapMetricColor,
  getHeatmapMetricTextColor,
  getMetricValue,
  getSignedMetricColor,
  type MetricConfig,
} from "./heatmapUtils";

export type { MetricConfig };

/**
 * Metric list for the sector page stock treemap. It is the NSE heatmap's
 * fundamentals list plus day change, which the sector page offers first and
 * exposes under its own label. Keeping it separate (rather than adding
 * `change_pct` to `METRICS`) keeps the NSE heatmap selectors unchanged.
 */
export const SECTOR_STOCK_METRICS: MetricConfig[] = [
  { value: "change_pct", label: "Day Change %", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
  ...METRICS,
];

/** Falls back to the first metric when `metric` is not in the caller's list. */
export function resolveStockMetric(metrics: MetricConfig[], metric: string): MetricConfig {
  return metrics.find((m) => m.value === metric) || metrics[0];
}

/**
 * A metric formatter must never throw: the caller can hand it a value from a
 * stale cache or a metric with no data on this universe. "—" is the honest
 * render for "no value", and it keeps one bad row from blanking the whole map.
 */
export function safeFmt(metric: { fmt: (v: number) => string }, value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  try {
    return metric.fmt(n);
  } catch {
    return "—";
  }
}

/** Min/max of `metric` across `stocks`; safe for empty lists. */
export function getStockMetricRange(
  stocks: HeatmapStock[],
  metric: string,
): { min: number; max: number } {
  const values = stocks.map((s) => getMetricValue(s, metric));
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 1,
  };
}

export interface StockTreemapLabelStyle {
  fontSize: number;
  fontWeight: number | "bold";
  lineHeight: number;
  textShadowColor?: string;
  textShadowBlur?: number;
  textBorderColor?: string;
  textBorderWidth?: number;
}

/**
 * Everything that legitimately differs between the surfaces sharing the stock
 * treemap (label typography/border, extra saturation band, tooltip change
 * colours). Data, colours and tooltip fields are shared.
 */
export interface StockTreemapStyle {
  /** Tile border colour in dark mode. */
  borderDark: string;
  /** Tile border colour in light mode. */
  borderLight: string;
  label: StockTreemapLabelStyle;
  /** ECharts `colorSaturation` for the second treemap level, when the surface uses one. */
  colorSaturation?: [number, number];
  /** Tooltip `Change:` row colours. */
  changePositive: string;
  changeNegative: string;
}

/** Tile area by market cap (a real map) or uniform (a grid). */
export type TreemapSizing = "uniform" | "market_cap";

export function buildStockTreemapOption(
  stocks: HeatmapStock[],
  metric: string,
  metrics: MetricConfig[],
  isDark: boolean,
  style: StockTreemapStyle,
  sizeBy: TreemapSizing = "uniform",
) {
  const activeMetric = resolveStockMetric(metrics, metric);
  const metricKey = activeMetric.value;
  const { min: metricMin, max: metricMax } = getStockMetricRange(stocks, metricKey);

  const data = stocks.map((stock) => {
    const mv = getMetricValue(stock, metricKey);
    const color = getHeatmapMetricColor(metricKey, mv, metricMin, metricMax);
    const textColor = getHeatmapMetricTextColor(metricKey, mv, metricMin, metricMax);
    const extra = stock as HeatmapStock & Record<string, unknown>;
    const weight = sizeBy === "market_cap" ? Math.max(stock.market_cap || 0, 0) : 1;
    return {
      name: stock.symbol,
      value: weight,
      path: stock.symbol,
      nameFull: stock.name,
      sector: stock.sector,
      price: stock.price,
      change: stock.change_pct,
      mcap: stock.market_cap,
      pe: stock.pe_ratio,
      score: extra.score,
      gap52: extra.to_52w_high,
      metricLabel: activeMetric.label,
      metricValue: safeFmt(activeMetric, mv),
      label: { color: textColor },
      itemStyle: { color },
    };
  });

  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipBorder = isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;
  const borderColor = isDark ? style.borderDark : style.borderLight;

  return {
    tooltip: {
      trigger: "item" as const,
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText },
      formatter: (params: { data?: Record<string, unknown> }) => {
        const d = params.data;
        if (!d) return "";
        const lines = [
          `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.name}</div>`,
          `<div style="color:${tooltipText};font-size:12px;opacity:0.8">${d.nameFull}</div>`,
          `<div style="margin-top:8px">`,
          `  <div style="color:${tooltipText}">${d.metricLabel}: <b>${d.metricValue}</b></div>`,
        ];
        if (d.pe != null && Number(d.pe) > 0) {
          lines.push(`  <div style="color:${tooltipText}">P/E: <b>${d.pe}</b></div>`);
        }
        if (d.mcap != null && Number(d.mcap) > 0) {
          lines.push(`  <div style="color:${tooltipText}">MCap: <b>${formatMarketCap(Number(d.mcap))}</b></div>`);
        }
        if (d.gap52 != null && d.gap52 !== "") {
          lines.push(`  <div style="color:${tooltipText}">52W Gap: <b>${Number(d.gap52).toFixed(2)}%</b></div>`);
        }
        if (d.score != null && d.score !== "") {
          lines.push(`  <div style="color:${tooltipText}">Score: <b>${d.score}</b></div>`);
        }
        if (d.price != null && Number(d.price) > 0) {
          lines.push(`  <div style="color:${tooltipText}">Price: <b>₹${Number(d.price).toFixed(2)}</b></div>`);
        }
        if (d.change != null && d.change !== "") {
          const ch = Number(d.change);
          const col = ch >= 0 ? style.changePositive : style.changeNegative;
          lines.push(
            `  <div style="color:${col}">Change: <b>${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</b></div>`,
          );
        }
        if (d.sector) {
          lines.push(`  <div style="color:${tooltipText}">Sector: ${d.sector}</div>`);
        }
        lines.push(`</div>`);
        return lines.join("\n");
      },
    },
    series: [
      {
        type: "treemap",
        sort: false,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        roam: false,
        squareRatio: 1,
        label: {
          show: true,
          formatter: (params: { name?: string; data?: { metricValue?: string } }) =>
            `${params.name}\n${params.data?.metricValue ?? ""}`,
          ...style.label,
        },
        breadcrumb: { show: false },
        itemStyle: {
          borderColor,
          borderWidth: 1,
          gapWidth: 0,
        },
        levels: [
          {
            itemStyle: {
              borderColor,
              borderWidth: 0,
              gapWidth: 0,
            },
          },
          {
            ...(style.colorSaturation ? { colorSaturation: style.colorSaturation } : {}),
            itemStyle: { borderColorSaturation: 0.6, gapWidth: 0, borderWidth: 1 },
          },
        ],
        data,
      },
    ],
  };
}

/** Kept for existing consumers: the sector page's stock treemap metric list. */
export { SECTOR_STOCK_METRICS as STOCK_METRICS, getSignedMetricColor };