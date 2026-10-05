/** Shared chart-patterns UI constants. */
export const LOOKBACK_OPTIONS: number[] = [60, 120, 250, 500, 1000];
export const MINI_CHART_HEIGHT = 128;
export const CHART_MAX_BARS = 2000;

/** Legend name for the swing-pivot marker toggle (single on/off entry). */
export const PIVOT_LEGEND_NAME = "Pivots";

/**
 * Fixed, high-contrast colours for pattern boundary lines, assigned in order:
 * the selected pattern takes index 0, siblings the next ones. Deliberately
 * avoids pure red/green (reserved for TLS/TLR) and leads with purple so the
 * selected pattern never blends into the blue/white candle scheme.
 */
export const PATTERN_SERIES_COLORS: string[] = [
  "#A371F7", // purple — selected pattern (distinct from blue/white candles)
  "#F0883E", // orange
  "#2DD4BF", // teal
  "#F472B6", // pink
  "#E3B341", // gold
  "#4C8DFF", // blue
  "#79C0FF", // light-blue
  "#FB923C", // light-orange
];
