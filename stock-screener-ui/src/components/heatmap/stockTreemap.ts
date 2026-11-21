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
  getRawMetricValue,
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
  // `Number(null)` is 0 and `Number("")` is 0, so a bare typeof check would
  // render a missing value as a real zero ("0.0%", "₹0.00"). Missing first.
  if (value == null || value === "") return "—";
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
  /**
   * Emit tiles largest-first (by area) so the map reads as a ranked list.
   * Off by default: the NSE and sector surfaces keep their incoming order.
   */
  sortTilesByValueDesc?: boolean;
}

/**
 * Tile area: a uniform grid, by market cap (a real map), or by the active
 * colour metric. `"metric"` deliberately reuses the resolved `metric` argument
 * so area and colour can never read different fields.
 */
export type TreemapSizing = "uniform" | "market_cap" | "metric";

/** Area given to a real-zero tile: 1% of the smallest non-zero tile. */
const ZERO_TILE_AREA_RATIO = 0.01;

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

  const sizeByMetric = sizeBy === "metric";
  // A real zero (a stock flat on the day) is a legitimate filtered-in row, so
  // metric mode keeps it at a sliver of the *smallest* non-zero area: it stays
  // visible without ever outgrowing a tile that actually moved. Flooring to a
  // fraction of the largest tile would promote tiny real values over bigger
  // ones. getRawMetricValue distinguishes a true zero from a missing value —
  // null/NaN/Infinity rows are still dropped, as before. Legacy modes keep
  // their exact previous output, including zero-cap rows.
  const nonZeroAreas = sizeByMetric
    ? stocks
        .map((stock) => getRawMetricValue(stock, metricKey))
        .filter((v): v is number => v !== null && Math.abs(v) > 0)
        .map((v) => Math.abs(v))
    : [];
  const smallestArea = nonZeroAreas.length ? Math.min(...nonZeroAreas) : 0;
  const zeroArea = smallestArea > 0 ? smallestArea * ZERO_TILE_AREA_RATIO : 1;
  const data = stocks.flatMap((stock) => {
    const mv = getMetricValue(stock, metricKey);
    if (sizeByMetric && getRawMetricValue(stock, metricKey) === null) return [];
    const magnitude = Math.abs(mv);
    const weight = sizeByMetric
      ? magnitude > 0 ? magnitude : zeroArea
      : sizeBy === "market_cap"
        ? Math.max(stock.market_cap || 0, 0)
        : 1;
    const color = getHeatmapMetricColor(metricKey, mv, metricMin, metricMax);
    const textColor = getHeatmapMetricTextColor(metricKey, mv, metricMin, metricMax);
    const extra = stock as HeatmapStock & Record<string, unknown>;
    return [{
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
      metricValue: safeFmt(activeMetric, getRawMetricValue(stock, metricKey)),
      // The canvas override recolours with this exact value, never by array
      // index: metric mode can drop rows, which would otherwise shift colours.
      metricNumeric: mv,
      label: { color: textColor },
      itemStyle: { color },
    }];
  });

  // ECharts holds array order when `sort: false` (set below), so sorting here
  // is both the emitted order and the on-screen layout. Array#sort is stable:
  // equal areas keep the caller's order. Scoped to the market map; the other
  // two callers leave the flag off and get byte-identical output.
  if (style.sortTilesByValueDesc) data.sort((a, b) => b.value - a.value);

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
        if (sizeByMetric) {
          lines.push(
            `  <div style="color:${tooltipText}">Tile size: <b>|${activeMetric.label}|</b></div>`,
          );
        }
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
        if (d.price != null && Number.isFinite(Number(d.price)) && Number(d.price) > 0) {
          lines.push(`  <div style="color:${tooltipText}">Price: <b>₹${Number(d.price).toFixed(2)}</b></div>`);
        }
        if (d.change != null && d.change !== "" && Number.isFinite(Number(d.change))) {
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
        nodeClick: false,
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