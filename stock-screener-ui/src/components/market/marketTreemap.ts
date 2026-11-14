import type { HeatmapStock } from "@/api/heatmap";
import type { MetricConfig } from "@/components/heatmap/heatmapUtils";
import type { MarketRow } from "@/types/marketScreener";
import { formatMarketCap } from "@/components/heatmap/heatmapUtils";

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

/**
 * Every formatter is total: a missing fundamental (TV has no P/E for ~20% of
 * NSE names) must render "—", never throw. `Number.isFinite` is the guard, not
 * `!= null`, because a stale cached snapshot can carry undefined fields.
 */
const dash = "—";

function show(value: unknown, render: (n: number) => string): string {
  return typeof value === "number" && Number.isFinite(value) ? render(value) : dash;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

export const MARKET_METRICS: MetricConfig[] = [
  { value: "market_cap", label: "Market Cap", fmt: (v) => show(v, formatMarketCap) },
  { value: "change_pct", label: "Day Change", fmt: (v) => show(v, pct) },
  { value: "pos_52w", label: "52W Position", fmt: (v) => show(v, (n) => `${n.toFixed(0)}%`) },
  { value: "relative_volume", label: "Rel Volume", fmt: (v) => show(v, (n) => `${n.toFixed(1)}x`) },
  { value: "rsi", label: "RSI", fmt: (v) => show(v, (n) => n.toFixed(1)) },
  { value: "adx", label: "ADX", fmt: (v) => show(v, (n) => n.toFixed(1)) },
  { value: "perf_w", label: "1W Return", fmt: (v) => show(v, pct) },
  { value: "perf_1m", label: "1M Return", fmt: (v) => show(v, pct) },
  { value: "pe_ratio", label: "P/E", fmt: (v) => show(v, (n) => n.toFixed(1)) },
  { value: "pb_ratio", label: "P/B", fmt: (v) => show(v, (n) => n.toFixed(2)) },
  { value: "roe", label: "ROE", fmt: (v) => show(v, (n) => `${n.toFixed(1)}%`) },
  { value: "dividend_yield", label: "Div Yield", fmt: (v) => show(v, (n) => `${n.toFixed(2)}%`) },
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
