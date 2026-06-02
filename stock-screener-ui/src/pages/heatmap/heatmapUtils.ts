import type { HeatmapStock } from "../../api/heatmap";

type Rgb = [number, number, number];

const COLOR_STOPS: [number, Rgb][] = [
  [0, [0, 90, 30]],
  [25, [80, 185, 70]],
  [50, [245, 230, 60]],
  [75, [235, 130, 40]],
  [100, [175, 35, 35]],
];

export function lerpRgb(t: number): string {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [p1, rgb1] = COLOR_STOPS[i];
    const [p2, rgb2] = COLOR_STOPS[i + 1];
    if (t >= p1 && t <= p2) {
      const p = (t - p1) / (p2 - p1);
      const r = Math.round(rgb1[0] + p * (rgb2[0] - rgb1[0]));
      const g = Math.round(rgb1[1] + p * (rgb2[1] - rgb1[1]));
      const b = Math.round(rgb1[2] + p * (rgb2[2] - rgb1[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(175,35,35)";
}

export function norm(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  const logMin = Math.log(Math.max(min, 1));
  const logMax = Math.log(Math.max(max, 1));
  const logVal = Math.log(Math.max(value, 1));
  return Math.min(Math.max((logVal - logMin) / (logMax - logMin), 0), 1);
}

/** Metrics where negative = red and positive = green (not magnitude-only). */
export const SIGNED_HEATMAP_METRICS = new Set([
  "day_change",
  "change_pct",
  "to_52w_high",
  "recent_return_5d",
  "perf_w",
  "impact_score",
  "gap_pct",
  "premarket_change",
  "move_pct",
  "perf_1y",
  "dividend_yield",
  "roe",
]);

export function isSignedHeatmapMetric(metric: string): boolean {
  return SIGNED_HEATMAP_METRICS.has(metric);
}

/** Green for gains, red for losses; intensity scales within each side. */
export function getSignedMetricColor(value: number, min: number, max: number): string {
  if (value > 0) {
    const t = max > 0 ? Math.min(value / max, 1) : 1;
    return lerpRgb(25 * t);
  }
  if (value < 0) {
    const t = min < 0 ? Math.min(Math.abs(value) / Math.abs(min), 1) : 1;
    return lerpRgb(75 + 25 * t);
  }
  return lerpRgb(50);
}

export function getMetricColor(value: number, min: number, max: number): string {
  return lerpRgb(norm(value, min, max) * 100);
}

export function getHeatmapMetricColor(
  metric: string,
  value: number,
  min: number,
  max: number,
): string {
  return isSignedHeatmapMetric(metric)
    ? getSignedMetricColor(value, min, max)
    : getMetricColor(value, min, max);
}

export function getMetricTextColor(value: number, min: number, max: number): string {
  const bg = getMetricColor(value, min, max);
  const m = bg.match(/\d+/g);
  if (!m) return "#fff";
  const l = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
  return l > 0.55 ? "#1a1a1a" : "#fff";
}

export function getHeatmapMetricTextColor(
  metric: string,
  value: number,
  min: number,
  max: number,
): string {
  const bg = getHeatmapMetricColor(metric, value, min, max);
  const m = bg.match(/\d+/g);
  if (!m) return "#fff";
  const l = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
  return l > 0.55 ? "#1a1a1a" : "#fff";
}

export function getMetricValue(stock: HeatmapStock, metric: string): number {
  const row = stock as HeatmapStock & Record<string, unknown>;
  switch (metric) {
    case "market_cap":
      return stock.market_cap;
    case "pe_ratio":
      return stock.pe_ratio;
    case "pb_ratio":
      return stock.pb_ratio ?? 0;
    case "dividend_yield":
      return stock.dividend_yield ?? 0;
    case "perf_1y":
      return stock.perf_1y ?? 0;
    case "roe":
      return stock.roe ?? 0;
    case "score":
      return Number(row.score) || 0;
    case "to_52w_high":
      return Number(row.to_52w_high) || 0;
    case "day_change":
      return Number(row.day_change) || 0;
    case "recent_return_5d":
      return Number(row.recent_return_5d) || 0;
    case "perf_w":
      return Number(row.perf_w) || 0;
    case "rsi":
      return Number(row.rsi) || 0;
    case "adx":
      return Number(row.adx) || 0;
    case "volume_m":
      return Number(row.volume_m) || 0;
    default:
      return 0;
  }
}

export function formatMarketCap(mcap: number): string {
  if (mcap >= 1e12) return `₹${(mcap / 1e12).toFixed(1)}T`;
  if (mcap >= 1e10) return `₹${(mcap / 1e10).toFixed(1)}L`;
  if (mcap >= 1e8) return `₹${(mcap / 1e8).toFixed(1)}Cr`;
  return `₹${(mcap / 1e6).toFixed(0)}M`;
}

export interface MetricConfig {
  value: string;
  label: string;
  fmt: (v: number) => string;
}

export const METRICS: MetricConfig[] = [
  { value: "market_cap", label: "Market Cap", fmt: (v) => formatMarketCap(v) },
  { value: "pe_ratio", label: "P/E Ratio", fmt: (v) => v.toFixed(1) },
  { value: "pb_ratio", label: "P/B Ratio", fmt: (v) => v.toFixed(2) },
  { value: "dividend_yield", label: "Div Yield", fmt: (v) => `${v.toFixed(2)}%` },
  { value: "perf_1y", label: "1Y Return", fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%` },
  { value: "roe", label: "ROE", fmt: (v) => `${v.toFixed(1)}%` },
];