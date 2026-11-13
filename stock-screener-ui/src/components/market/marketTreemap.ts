import type { HeatmapStock } from "@/api/heatmap";
import type { MetricConfig } from "@/pages/heatmap/heatmapUtils";
import type { MarketRow } from "@/types/marketScreener";
import { formatMarketCap } from "@/pages/heatmap/heatmapUtils";

export interface MarketTreemapRow extends HeatmapStock {
  rsi: number | null;
  adx: number | null;
  relative_volume: number | null;
  pos_52w: number | null;
  perf_w: number | null;
  perf_1m: number | null;
}

const CRORE = 1e7;

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function toTreemapRow(row: MarketRow): MarketTreemapRow {
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector ?? "—",
    market_cap: row.marketCapCr != null ? row.marketCapCr * CRORE : 0,
    pe_ratio: num(row.peRatio) ?? Number.NaN,
    pb_ratio: num(row.pbRatio),
    dividend_yield: num(row.dividendYield),
    perf_1y: num(row.perf1m) ?? Number.NaN,
    roe: num(row.roe),
    high_52w: num(row.high52w),
    low_52w: num(row.low52w),
    price: num(row.close) ?? 0,
    change_pct: num(row.change) ?? 0,
    rsi: num(row.rsi),
    adx: num(row.adx),
    relative_volume: num(row.relativeVolume),
    pos_52w: num(row.pos52w),
    perf_w: num(row.perfW),
    perf_1m: num(row.perf1m),
  };
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export const MARKET_METRICS: MetricConfig[] = [
  { value: "market_cap", label: "Market Cap", fmt: (v) => formatMarketCap(v) },
  { value: "change_pct", label: "Day Change", fmt: pct },
  { value: "pos_52w", label: "52W Position", fmt: (v) => `${v.toFixed(0)}%` },
  { value: "relative_volume", label: "Rel Volume", fmt: (v) => `${v.toFixed(1)}x` },
  { value: "rsi", label: "RSI", fmt: (v) => v.toFixed(1) },
  { value: "adx", label: "ADX", fmt: (v) => v.toFixed(1) },
  { value: "perf_w", label: "1W Return", fmt: pct },
  { value: "perf_1m", label: "1M Return", fmt: pct },
  { value: "pe_ratio", label: "P/E", fmt: (v) => v.toFixed(1) },
  { value: "pb_ratio", label: "P/B", fmt: (v) => v.toFixed(2) },
  { value: "roe", label: "ROE", fmt: (v) => `${v.toFixed(1)}%` },
  { value: "dividend_yield", label: "Div Yield", fmt: (v) => `${v.toFixed(2)}%` },
];

export const MARKET_SIGNED_METRICS = new Set([
  "change_pct",
  "perf_w",
  "perf_1m",
  "pos_52w",
]);

export function isMarketSignedMetric(metric: string): boolean {
  return MARKET_SIGNED_METRICS.has(metric);
}
