import type { HeatmapStock } from "../../api/heatmap";
import type { Stock } from "../../types";
import type { MetricConfig } from "../../pages/heatmap/heatmapUtils";

/** Metrics available when coloring screener treemap tiles. */
export const SCREENER_HEATMAP_METRICS: MetricConfig[] = [
  { value: "score", label: "Score", fmt: (v) => String(Math.round(v)) },
  { value: "to_52w_high", label: "52W Gap %", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
  { value: "day_change", label: "Day %", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` },
  { value: "recent_return_5d", label: "5D %", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
  { value: "perf_w", label: "Perf W", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
  { value: "rsi", label: "RSI", fmt: (v) => v.toFixed(1) },
  { value: "adx", label: "ADX", fmt: (v) => v.toFixed(1) },
  { value: "volume_m", label: "Vol M", fmt: (v) => v.toFixed(2) },
];

export function defaultScreenerHeatmapMetric(screenerId: string): string {
  if (screenerId === "52w_high" || screenerId.includes("52w")) {
    return "to_52w_high";
  }
  if (screenerId === "nifty_movers") {
    return "day_change";
  }
  return "score";
}

/** Map screener rows to heatmap treemap input (keeps screener fields for coloring). */
export function stocksToHeatmapRows(stocks: Stock[]): (HeatmapStock & Stock)[] {
  return stocks.map((stock) => ({
    ...stock,
    symbol: stock.symbol,
    name: stock.symbol,
    sector: stock.sector || "—",
    market_cap: (stock.market_cap_b ?? 1) * 1e9,
    pe_ratio: 0,
    pb_ratio: null,
    dividend_yield: null,
    perf_1y: stock.perf_w ?? null,
    roe: null,
    high_52w: stock.high_52w ?? null,
    low_52w: stock.low_52w ?? null,
    price: stock.upstox_price ?? stock.tv_price ?? 0,
    change_pct: stock.day_change ?? 0,
  })) as (HeatmapStock & Stock)[];
}