import type { HeatmapStock } from "@/api/heatmap";
import {
  formatMarketCap,
  getRawMetricValue,
  type MetricConfig,
} from "@/components/heatmap/heatmapUtils";
import { pickTextColor } from "@/utils/contrast";
import { buildStockTreemapOption, type StockTreemapStyle } from "@/components/heatmap/stockTreemap";
import type { MarketRow } from "@/types/marketScreener";
import { currencyFor, type CurrencyCode } from "@/config/currency";
import { descriptorForCurrency, marketCapOf } from "@/config/marketUniverses";
import {
  BORDER,
  CREAM,
  BROWN_DARK,
  VIRIDIS_STOPS,
  SURFACE_ALT,
  TEXT,
  TEXT_ON_ACCENT,
} from "@/ui/palette";

export interface MarketTreemapRow extends HeatmapStock {
  rsi: number | null;
  adx: number | null;
  relative_volume: number | null;
  pos_52w: number | null;
  perf_w: number | null;
  perf_1m: number | null;
}

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

// A bare `.map(toTreemapRow)` hands the array index through as the second
// argument; treat anything non-string as the default currency, not a crash.
const quoteCurrency = (currency?: CurrencyCode): string | undefined =>
  typeof currency === "string" ? currency : undefined;

export function toTreemapRow(row: MarketRow, currency?: CurrencyCode): MarketTreemapRow {
  const spec = currencyFor(quoteCurrency(currency));
  const cap = marketCapOf(row, descriptorForCurrency(quoteCurrency(currency)));
  return {
    symbol: row.symbol,
    name: row.name,
    sector: row.sector ?? "—",
    market_cap: cap != null ? cap * spec.mcapScale : 0,
    pe_ratio: num(row.peRatio) ?? Number.NaN,
    pb_ratio: num(row.pbRatio),
    dividend_yield: num(row.dividendYield),
    // The market snapshot has no 1-year return. It used to put perf1m here,
    // so a "1Y Return" read was silently a 1-month number.
    perf_1y: null,
    roe: num(row.roe),
    high_52w: num(row.high52w),
    low_52w: num(row.low52w),
    price: num(row.close) ?? Number.NaN,
    change_pct: num(row.change) ?? Number.NaN,
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

/** The cap tile's unit travels with the currency it was scaled with. */
function marketCapFormatter(currency?: CurrencyCode): (v: number) => string {
  const spec = currencyFor(currency);
  // Keep the shared India formatter for the default path — its compact bands
  // are load-bearing and already agreed with the table's cap column.
  if (spec.code === "INR") return (v) => show(v, formatMarketCap);
  return (v) => show(v, (n) => `${spec.symbol}${spec.compact(n)}`);
}

/**
 * Grouping is a market-map-only concern. `MetricConfig` is shared with
 * HeatmapTreemap/SectorHeatmapView; widen it locally instead so those surfaces
 * keep their byte-identical option shapes.
 */
interface GroupedMetricConfig extends MetricConfig {
  group?: string;
}

/** India stays the default; a US map asks for its own descriptor-backed unit. */
export function marketTreemapMetrics(currency?: CurrencyCode): GroupedMetricConfig[] {
  return [
    { value: "change_pct", label: "Day Change", group: "Momentum", fmt: (v) => show(v, pct) },
    { value: "relative_volume", label: "Rel Volume", group: "Momentum", fmt: (v) => show(v, (n) => `${n.toFixed(1)}x`) },
    { value: "rsi", label: "RSI", group: "Momentum", fmt: (v) => show(v, (n) => n.toFixed(1)) },

    { value: "adx", label: "ADX", group: "Trend", fmt: (v) => show(v, (n) => n.toFixed(1)) },
    // The backend already shapes this as a 0–100 percentage
    // (`snapshot.py`: `(close - low) / (high - low) * 100`), the same unit the
    // table's 52W bar uses. Clamp to that range so a stale/derivative row can
    // never print 150% — and never multiply by 100 here, which would turn a
    // real 81 into 8100%. Only out-of-range rows differ from the raw value.
    {
      value: "pos_52w",
      label: "52W Position",
      group: "Trend",
      fmt: (v) => show(v, (n) => `${Math.max(0, Math.min(100, n)).toFixed(0)}%`),
    },

    { value: "perf_w", label: "1W Return", group: "Performance", fmt: (v) => show(v, pct) },
    { value: "perf_1m", label: "1M Return", group: "Performance", fmt: (v) => show(v, pct) },

    { value: "market_cap", label: "Market Cap", group: "Size", fmt: marketCapFormatter(currency) },

    { value: "pe_ratio", label: "P/E", group: "Valuation", fmt: (v) => show(v, (n) => n.toFixed(1)) },
    { value: "pb_ratio", label: "P/B", group: "Valuation", fmt: (v) => show(v, (n) => n.toFixed(2)) },
    { value: "roe", label: "ROE", group: "Valuation", fmt: (v) => show(v, (n) => `${n.toFixed(1)}%`) },
    { value: "dividend_yield", label: "Div Yield", group: "Valuation", fmt: (v) => show(v, (n) => `${n.toFixed(2)}%`) },
  ];
}

export const MARKET_METRICS: MetricConfig[] = marketTreemapMetrics();

export interface MarketMetricOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

/**
 * The map's Select data: same order and value strings as the metric list. Every
 * grouped metric is a real, selectable size field — none is display-only.
 */
export function marketMetricOptions(currency?: CurrencyCode): MarketMetricOption[] {
  return marketTreemapMetrics(currency).map(({ value, label, group }) => ({
    value,
    label,
    group,
  }));
}

/**
 * Tile area is |value|, so a negative metric is still drawable. A field with no
 * finite non-zero value anywhere in the snapshot cannot produce a tile: mark
 * it disabled in Size by (the option stays so a controlled select keeps its
 * value across refreshes). It stays selectable for Colour by, where a flat or
 * missing distribution still gets an honest viridis fill.
 */
export function usableSizeMetrics(
  stocks: HeatmapStock[],
  options: MarketMetricOption[],
): MarketMetricOption[] {
  if (!stocks.length) return options;
  return options.map((option) => {
    const usable = stocks.some((stock) => {
      const value = getRawMetricValue(stock, option.value);
      return value !== null && Math.abs(value) > 0;
    });
    return usable ? option : { ...option, disabled: true };
  });
}

/**
 * The selectable metric vocabulary shared by Size by and Colour by. Every
 * value here is a real `MarketRow` field carried through `toTreemapRow`; tile
 * area is |value| when a metric sizes the map. Day change is the default for
 * direct map renders, market cap for the window panel's size control.
 * This is the persisted `colorBy` wire set. The original five keep their order
 * for backwards compatibility; the seven fundamental/trend fields were added
 * so every visible dropdown option is selectable and restorable.
 */
export const MARKET_SIZE_METRIC_VALUES = [
  "change_pct",
  "relative_volume",
  "rsi",
  "pos_52w",
  "market_cap",
  "adx",
  "perf_w",
  "perf_1m",
  "pe_ratio",
  "pb_ratio",
  "roe",
  "dividend_yield",
] as const;
export type MarketSizeMetric = (typeof MARKET_SIZE_METRIC_VALUES)[number];
export const DEFAULT_MARKET_SIZE_METRIC: MarketSizeMetric = "change_pct";
/** The window panel splits the encodings: a true magnitude for area, momentum for hue. */
export const DEFAULT_HEATMAP_SIZE_METRIC: MarketSizeMetric = "market_cap";
export const DEFAULT_HEATMAP_COLOR_METRIC: MarketSizeMetric = "change_pct";

const SIZE_METRICS = new Set<string>(MARKET_SIZE_METRIC_VALUES);

export function isMarketSizeMetric(value: unknown): value is MarketSizeMetric {
  return typeof value === "string" && SIZE_METRICS.has(value);
}

export function marketSizeMetrics(currency?: CurrencyCode): MetricConfig[] {
  const all = marketTreemapMetrics(currency);
  return MARKET_SIZE_METRIC_VALUES.map((value) => all.find((m) => m.value === value)!);
}

export const MARKET_SIZE_METRICS: MetricConfig[] = marketSizeMetrics();

/**
 * Signed metrics diverge at zero; every other market metric is a plain
 * magnitude. Cividis is sequential, so BOTH are mapped by their position in
 * [min,max] onto the same low → high ramp — there is no green/red pole and no
 * neutral colour at zero. The legend says "low → high" so a cool fill is read
 * as a low value, not as a loss.
 */
export const MARKET_SIGNED_METRICS: ReadonlySet<string> = new Set([
  "change_pct",
  "perf_w",
  "perf_1m",
]);

export function isMarketSignedMetric(metric: string): boolean {
  return MARKET_SIGNED_METRICS.has(metric);
}

// One corporate-action print (+12026% in the live snapshot) otherwise becomes
// the ramp's extent and leaves every normal ±5% tile at t≈0.02 — one colour.
// MAD is the primary scale: a single absurd value cannot move a median. 1.4826
// makes it a consistent normal sigma estimate; IQR (then a fraction of the
// observed range) covers the degenerate case where >50% of rows are identical.
export const ROBUST_MAD_SCALE = 1.4826;
export const ROBUST_IQR_SCALE = 1.349;
export const ROBUST_OUTLIER_SIGMAS = 4;

export interface RobustColorBounds {
  low: number;
  high: number;
}

export interface MarketColorDomain {
  min: number;
  max: number;
  /** The raw low/high was pulled inside the robust window (legend must say so). */
  clampedLow: boolean;
  clampedHigh: boolean;
}

function percentileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  if (sorted.length === 1) return sorted[0]!;
  const at = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (at - lo) * (sorted[hi]! - sorted[lo]!);
}

/**
 * Robust window for the fill ramp. Signed metrics diverge at zero, so their
 * window is symmetric — centred on the median first (the bulk need not sit at
 * zero) and then mirrored. Unusable extremes stay `±Infinity` when every
 * value is identical, which tells `marketColorDomain` not to clamp at all.
 */
export function robustColorBounds(values: number[], signed: boolean): RobustColorBounds {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };

  const sorted = [...finite].sort((a, b) => a - b);
  const center = percentileSorted(sorted, 50);
  const deviations = sorted.map((v) => Math.abs(v - center)).sort((a, b) => a - b);
  let spread = ROBUST_MAD_SCALE * percentileSorted(deviations, 50);
  if (!(spread > 0)) {
    spread =
      (percentileSorted(sorted, 75) - percentileSorted(sorted, 25)) / ROBUST_IQR_SCALE;
  }
  if (!(spread > 0)) {
    // No dispersion signal at all (>50% identical and a zero IQR). A lone
    // extreme still has to saturate, so use half the observed range here.
    spread = (sorted[sorted.length - 1]! - sorted[0]!) / (2 * ROBUST_OUTLIER_SIGMAS);
  }
  if (!(spread > 0)) return { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY };

  const half = ROBUST_OUTLIER_SIGMAS * spread;
  if (signed) {
    const extent = Math.max(Math.abs(center - half), Math.abs(center + half), 0.01);
    return { low: -extent, high: extent };
  }
  return { low: center - half, high: center + half };
}

/**
 * The one domain used by BOTH market treemaps and both legends. It is the raw
 * min/max clamped to the robust window, so a clean distribution keeps its old
 * exact fills while an outlier saturates at the ramp end instead of flattening
 * everything into one hue. Rows with no finite value are excluded, never
 * zero-filled into the median, and the underlying data is never rewritten.
 */
export function marketColorDomain(stocks: HeatmapStock[], metric: string): MarketColorDomain {
  const values = stocks
    .map((stock) => getRawMetricValue(stock, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return { min: 0, max: 1, clampedLow: false, clampedHigh: false };

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const bounds = robustColorBounds(values, isMarketSignedMetric(metric));

  if (isMarketSignedMetric(metric)) {
    // `marketSignedMetricColor` only reads max(|min|,|max|), so shrink the extent
    // itself. Clamping the raw ends (rather than forcing a symmetric pair)
    // keeps an unclamped legend showing the true -12.9% .. +29.3% endpoints.
    const rawExtent = Math.max(Math.abs(rawMin), Math.abs(rawMax), 0.01);
    const extent = Math.min(rawExtent, bounds.high);
    const min = Math.max(rawMin, -extent);
    const max = Math.min(rawMax, extent);
    return {
      min,
      max,
      clampedLow: min > rawMin,
      clampedHigh: max < rawMax,
    };
  }

  const min = Math.max(rawMin, bounds.low);
  const max = Math.max(min, Math.min(rawMax, bounds.high));
  return {
    min,
    max,
    clampedLow: min > rawMin,
    clampedHigh: max < rawMax,
  };
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Market-local stops. The shared RAMP_* stops are byte-pinned by the NSE and
 * sector builder snapshots, so the market map owns its own ramp. Viridis is
 * monotone in luminance across all 17 stops: low → deep purple, high → yellow.
 */
const VIRIDIS_RGB: Rgb[] = VIRIDIS_STOPS.map(hexToRgb);
const VIRIDIS_LAST = VIRIDIS_RGB.length - 1;

/** t is the 0..100 position on the ramp; NaN degrades to the mid stop. */
export function marketLerpRgb(t: number): string {
  if (!Number.isFinite(t)) return `rgb(${VIRIDIS_RGB[8]!.join(",")})`;
  const scaled = (Math.min(Math.max(t, 0), 100) / 100) * VIRIDIS_LAST;
  const index = Math.min(Math.floor(scaled), VIRIDIS_LAST - 1);
  const p = scaled - index;
  const a = VIRIDIS_RGB[index]!;
  const b = VIRIDIS_RGB[index + 1]!;
  const r = Math.round(a[0] + p * (b[0] - a[0]));
  const g = Math.round(a[1] + p * (b[1] - a[1]));
  const blue = Math.round(a[2] + p * (b[2] - a[2]));
  return `rgb(${r},${g},${blue})`;
}

/**
 * Linear position in [min,max] → the SAME viridis ramp for every metric.
 * `getMetricColor`'s shared `norm()` is a log scale that divides by zero below
 * 1 and is left alone; the market ramp computes its position locally. Zero is
 * not a neutral anchor — a value's position is all that decides its fill.
 */
function marketPositionColor(value: number, min: number, max: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return marketLerpRgb(50);
  }
  const position = Math.min(Math.max((value - min) / (max - min), 0), 1);
  return marketLerpRgb(position * 100);
}

/** Kept for callers/tests; signed metrics now share the sequential mapping. */
export function marketSignedMetricColor(value: number, min: number, max: number): string {
  return marketPositionColor(value, min, max);
}

/** Legacy three-argument calls keep colouring by day change. */
function colorArgs(
  metricOrValue: string | number,
  valueOrMin: number,
  minOrMax: number,
  max?: number,
): { metric: string; value: number; min: number; max: number } {
  if (typeof metricOrValue === "string") {
    return {
      metric: metricOrValue,
      value: valueOrMin,
      min: minOrMax,
      max: typeof max === "number" ? max : minOrMax,
    };
  }
  return {
    metric: DEFAULT_MARKET_SIZE_METRIC,
    value: metricOrValue,
    min: valueOrMin,
    max: minOrMax,
  };
}

export function marketTileColor(
  metricOrValue: string | number,
  valueOrMin: number,
  minOrMax: number,
  max?: number,
): string {
  const { value, min, max: upper } = colorArgs(metricOrValue, valueOrMin, minOrMax, max);
  const safeUpper = Number.isFinite(upper) ? upper : min;
  return marketPositionColor(value, min, safeUpper);
}

export function marketTileTextColor(
  metricOrValue: string | number,
  valueOrMin: number,
  minOrMax: number,
  max?: number,
): string {
  // Every viridis stop clears 4.5:1 with the better ink, so the label never
  // lands on an unreadable mid-tone.
  return pickTextColor(marketTileColor(metricOrValue, valueOrMin, minOrMax, max), TEXT_ON_ACCENT);
}

/** The exact red→green ramp used by the tiles, for the legend swatch. */
export function marketColorRampCss(): string {
  return `linear-gradient(to right, ${VIRIDIS_STOPS.join(", ")})`;
}

/**
 * The stops are RED_GREEN_HEATMAP_STOPS (aliased as VIRIDIS_STOPS for the
 * shared ramp consumers) — red → neutral → green, not sequential viridis.
 * Both legends print the one string below so they cannot drift apart; the
 * rendered note is a position caption, not a claim about gain/loss semantics.
 */
export const MARKET_COLOR_SCALE_NOTE = "low → high · position in range, not gain/loss";

/**
 * Legibility guard for the nested map. A full NSE snapshot has ~2,000 names;
 * drawing every stock inside its sector destroys the map. Keep the largest N
 * stocks per sector and roll the remainder into one "Other (n)" child whose
 * area is the sum of the tail — every name stays represented and the sector
 * block still equals the sum of all of its stocks.
 */
export const MAX_STOCKS_PER_SECTOR = 12;

/**
 * On a phone the chart is only ~390px wide. Twelve stock tiles inside each of
 * ~30 sectors leaves each tile a few pixels, which ECharts ellipsises to a bare
 * "S…" — the low tile count, not the formatter, is the real defect. Cap at 4
 * below the narrow threshold so a sector's tiles are wide enough to read, and
 * fold the rest into the existing "+n" aggregate.
 */
export const MAX_STOCKS_PER_SECTOR_NARROW = 4;

/** Chart-container width below which the nested map switches to its narrow form. */
export const NARROW_TREEMAP_MAX_WIDTH = 600;

/** Max characters the narrow leaf formatter prints — no ellipsis of our own. */
export const NARROW_SYMBOL_MAX_CHARS = 6;

export function isNarrowTreemap(width?: number): boolean {
  return width !== undefined && width < NARROW_TREEMAP_MAX_WIDTH;
}

export function maxStocksPerSector(width?: number): number {
  return isNarrowTreemap(width) ? MAX_STOCKS_PER_SECTOR_NARROW : MAX_STOCKS_PER_SECTOR;
}

/**
 * Narrow tiles cannot fit the two-line "SYMBOL\nmetric" leaf label. Emit a
 * single short symbol instead. It never contains an ellipsis and the full
 * symbol stays on `name` for the tooltip, so a tile can no longer read as a
 * bare "S…" that identifies no stock.
 */
export function shortTreemapSymbol(symbol: string): string {
  return symbol.trim().slice(0, NARROW_SYMBOL_MAX_CHARS);
}

/** Rows with no usable sector land here, never in a phantom sector named "—". */
export const UNCLASSIFIED_SECTOR = "Unclassified";

export interface SectorTreemapTile {
  name: string;
  value: number;
  sector?: string;
  change?: number;
  /** True on the "Other (n)" rollup — no symbol, so a click must not open the dock. */
  isOther?: boolean;
  /** True on a sector parent — the canvas recolours only stock children. */
  sectorParent?: boolean;
  children?: SectorTreemapTile[];
  [key: string]: unknown;
}

export interface SectorTreemapOption {
  tooltip: unknown;
  series: Array<Record<string, unknown> & { data: SectorTreemapTile[] }>;
  [key: string]: unknown;
}

export interface SectorTreemapBuild {
  option: SectorTreemapOption;
  /** Real stock tiles represented (excludes the "Other" rollups). */
  stockCount: number;
  sectorCount: number;
  otherBlockCount: number;
}

export interface SectorTreemapBuildOptions {
  /** Chart container width in px. Affects label visibility only — never ordering. */
  width?: number;
  /** Chart container height in px. Used with width by the tile-width proxy. */
  height?: number;
}

/** Below this width a sector header overlaps its tiles, so it is hidden instead. */
export const SECTOR_LABEL_MIN_WIDTH = 480;

/**
 * Minimum estimated pixel width for a stock tile to carry its two-line
 * "SYMBOL\nvalue" label. Below it ECharts ellipsises the symbol to a bare
 * "S…" that identifies nothing, so the whole label block is hidden.
 *
 * Derived from the 10px bold symbol font of the nested map
 * (`NESTED_TREEMAP_STYLE.label.fontSize`): at ~0.6em average advance that is
 * ~6px per glyph, so a 6-character symbol is ~36px and the value line
 * ("-5.0%", 5 chars) ~30px. The wider line sets the floor: 36 + 2px slack.
 */
export const MIN_LABEL_WIDTH_PX = 38;

/**
 * Vertical room a two-line label needs. The same 10px bold font on a ~11px
 * line × 2 lines plus padding. Width alone was never enough: a 40×12 tile
 * passes the 38px width gate but cannot fit two lines, so ECharts clipped the
 * value to `+0.|` — a fragment that reads as data and is not.
 */
export const MIN_LABEL_HEIGHT_PX = 26;
/** One line only fits once the tile is at least this tall. */
export const MIN_LABEL_LINE_HEIGHT_PX = 14;

/** Chart box used by the width proxy before the canvas reports its real size. */
const FALLBACK_TREEMAP_WIDTH_PX = 1200;
const FALLBACK_TREEMAP_HEIGHT_PX = 700;

/**
 * ECharts does not expose a leaf's pixel geometry to its label formatter, so
 * width is derived from the treemap area contract:
 *
 *   area_i = (value_i / Σ value_leaves) × W × H
 *
 * Nesting does not change this: a sector's area is its share of the grand
 * total and a child's area is its share of the sector, so the product is the
 * same share. A squarified treemap keeps leaves near-square, hence
 * width ≈ √area_i. The denominator includes the folded "+n" tail so a badge
 * is never measured against a total that omits its own area.
 */
export function estimatedTileWidthPx(
  value: number,
  totalValue: number,
  widthPx?: number,
  heightPx?: number,
): number {
  return estimatedTileHeightPx(value, totalValue, widthPx, heightPx);
}

/**
 * A squarified treemap keeps leaves near-square, so one side length describes
 * both dimensions. It is named for the axis it is used to gate, and the height
 * gate reuses the same proxy.
 */
export function estimatedTileHeightPx(
  value: number,
  totalValue: number,
  widthPx?: number,
  heightPx?: number,
): number {
  const w = widthPx && widthPx > 0 ? widthPx : FALLBACK_TREEMAP_WIDTH_PX;
  const h = heightPx && heightPx > 0 ? heightPx : FALLBACK_TREEMAP_HEIGHT_PX;
  if (!Number.isFinite(value) || !Number.isFinite(totalValue) || value <= 0 || totalValue <= 0) {
    return 0;
  }
  return Math.sqrt((value / totalValue) * w * h);
}

/** The single gate for the whole label block — symbol and value lines together. */
export function stockTileLabelVisible(
  value: number,
  totalValue: number,
  widthPx?: number,
  heightPx?: number,
): boolean {
  const side = estimatedTileHeightPx(value, totalValue, widthPx, heightPx);
  // Both dimensions must clear their floor. Width was the only check, so a
  // short tile rendered a clipped second line instead of nothing.
  return side >= MIN_LABEL_WIDTH_PX && side >= MIN_LABEL_HEIGHT_PX;
}

/**
 * The label text for a tile, or `null` when it must paint nothing.
 *
 * Precedence is deliberate: a ticker without its percentage is still
 * identifiable, while a percentage fragment (`+0.|`) identifies nothing and
 * reads as a real value. So when only one line fits, keep the symbol.
 */
export function marketTileLabelText(
  side: number,
  symbol: string,
  value: string,
): string | null {
  if (!Number.isFinite(side) || side <= 0) return null;
  if (side >= MIN_LABEL_HEIGHT_PX) {
    return `{sym|${symbol}}\n{val|${value}}`;
  }
  if (side >= MIN_LABEL_LINE_HEIGHT_PX) {
    return `{sym|${symbol}}`;
  }
  return null;
}

/**
 * Flat-map typography is the 12px `micro` floor with a 14px line box: two
 * lines need ~30px of height and the longer line needs ~44px of width. The
 * nested map's 38×26 proxy is not enough here — ECharts squarifies into strips,
 * so a leaf whose √(area) is 46px can really be 60×34 and its two lines are
 * pixel-clipped to `SO…` / `+20…`.
 */
export const FLAT_LABEL_MIN_WIDTH_PX = 44;
export const FLAT_LABEL_MIN_HEIGHT_PX = 30;
/** Worst squarify aspect the area proxy must survive before a label is allowed. */
export const FLAT_LABEL_ASPECT_SAFETY = 1.4;
/**
 * A full snapshot has thousands of tiles competing for a few readable areas.
 * Past this many, paint only the largest labels; every other name stays fully
 * reachable on hover through the datum's tooltip fields.
 */
export const MAX_FLAT_LABELS = 24;

export interface TileLabelRect {
  width: number;
  height: number;
}

export interface TileLabelPolicy {
  show: boolean;
  symbol: string;
  change: string;
}

/**
 * One decision for the whole label block. There is deliberately no short or
 * ellipsised branch: a two-character stub identifies no company and is worse
 * than an unlabelled tile. Callers that cannot fit both lines must paint
 * nothing, while `symbol` and `change` stay complete for the tooltip.
 */
export function labelPolicy(
  row: { symbol?: string; name?: string; change?: number | null; metricValue?: string },
  rect: TileLabelRect,
): TileLabelPolicy {
  const raw = typeof row.symbol === "string" ? row.symbol : row.name;
  const symbol = typeof raw === "string" ? raw.trim() : "";
  const change =
    typeof row.change === "number" && Number.isFinite(row.change)
      ? pct(row.change)
      : typeof row.metricValue === "string" && row.metricValue !== ""
        ? row.metricValue
        : dash;
  // ECharts squarifies into strips, so the short edge — not the width — is what
  // clips two lines. Gate on the smaller side and require the worst tolerated
  // aspect to clear both typography floors.
  const shortSide = Math.min(rect.width, rect.height);
  const show =
    symbol.length > 0 &&
    Number.isFinite(shortSide) &&
    shortSide >= FLAT_LABEL_MIN_WIDTH_PX * FLAT_LABEL_ASPECT_SAFETY &&
    shortSide >= FLAT_LABEL_MIN_HEIGHT_PX * FLAT_LABEL_ASPECT_SAFETY;
  return { show, symbol, change };
}

interface FlatLabelTile {
  value: number;
  name?: string;
  symbol?: string;
  change?: number | null;
  metricValue?: string;
  label?: Record<string, unknown>;
}

/**
 * Decides the flat map's labels once for the whole option: gate each tile by a
 * conservative short-side proxy, then keep only the largest `MAX_FLAT_LABELS`
 * readable ones. The datum's name, fill, tooltip and click target are
 * untouched, and a shown label keeps the inherited full-symbol formatter —
 * no short/ellipsis variant exists for either map.
 */
export function suppressTinyFlatLabels<T extends FlatLabelTile>(
  tiles: T[],
  widthPx?: number,
  heightPx?: number,
): T[] {
  const total = tiles.reduce((sum, tile) => sum + tile.value, 0);
  const sides = tiles.map((tile) =>
    estimatedTileHeightPx(tile.value, total, widthPx, heightPx),
  );
  // A handful of leaves get near-square cells from ECharts, so the established
  // nested-map gate is enough and a small map's option stays byte-identical.
  // With thousands of leaves squarify produces strips, where the √area proxy
  // overstates the short edge and ECharts clips a two-line label into `SO…`.
  const dense = tiles.length > MAX_FLAT_LABELS;
  const readable = sides.map((side, index) =>
    dense
      ? labelPolicy(tiles[index]!, { width: side, height: side }).show
      : stockTileLabelVisible(tiles[index]!.value, total, widthPx, heightPx),
  );

  const keep = new Set<number>();
  sides
    .map((side, index) => ({ side, index }))
    .filter(({ index }) => readable[index])
    .sort((a, b) => b.side - a.side || a.index - b.index)
    .slice(0, MAX_FLAT_LABELS)
    .forEach(({ index }) => keep.add(index));

  // Re-suppressing already-decorated tiles (a resize that moves no label across
  // a threshold) must not allocate a new array and a new label for every tile.
  // Comparing against the real inputs keeps this free of stale caches. A stale
  // one-line formatter from an earlier decision is always a change: no stub may
  // survive, even on a tile whose show flag has not moved.
  let needsChange = false;
  for (let index = 0; index < tiles.length; index++) {
    const show = keep.has(index);
    if (tiles[index]!.label?.show !== show || "formatter" in (tiles[index]!.label ?? {})) {
      needsChange = true;
      break;
    }
  }
  if (!needsChange) return tiles;

  return tiles.map((tile, index) => {
    // Drop a formatter left by a previous one-line decision: a growing tile
    // must inherit the full two-line formatter, not a 6-character stub.
    const { formatter: _previous, ...label } = tile.label ?? {};
    return { ...tile, label: { ...label, show: keep.has(index) } };
  });
}

/** `toTreemapRow` stores a null sector as "—"; normalise that and blank strings. */
export function sectorOf(value: unknown): string {
  if (typeof value !== "string") return UNCLASSIFIED_SECTOR;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "—" ? UNCLASSIFIED_SECTOR : trimmed;
}

/**
 * Builds the nested treemap from the shared builder's flat tiles. The shared
 * function is called unchanged (with its sort flag off — sorting is done here
 * per sector), so the NSE and sector heatmaps keep their exact output. Tile
 * areas, missing-value dropping and metric labels all come from that one source.
 */
export function buildSectorTreemapOption(
  stocks: MarketTreemapRow[],
  metric: MarketSizeMetric,
  metrics: MetricConfig[],
  isDark: boolean,
  style: StockTreemapStyle,
  options?: SectorTreemapBuildOptions,
): SectorTreemapBuild {
  const flat = buildStockTreemapOption(
    stocks as HeatmapStock[],
    metric,
    metrics,
    isDark,
    { ...style, sortTilesByValueDesc: false },
    "metric",
  );

  const tiles = (flat.series[0].data ?? []) as SectorTreemapTile[];
  const groups = new Map<string, SectorTreemapTile[]>();
  for (const tile of tiles) {
    const sector = sectorOf(tile.sector);
    const members = groups.get(sector) ?? [];
    members.push({ ...tile, sector });
    groups.set(sector, members);
  }

  const parentFill = isDark ? SURFACE_ALT : CREAM;
  const parentLabelColor = isDark ? TEXT : BROWN_DARK;
  const boundary = isDark ? BORDER : CREAM;
  const showSectorLabels = options?.width === undefined || options.width >= SECTOR_LABEL_MIN_WIDTH;
  const narrow = isNarrowTreemap(options?.width);
  const stockCap = maxStocksPerSector(options?.width);
  // The folded "+n" tail still owns its area: measure every leaf, not just the
  // capped children that get a painted label.
  const totalLeafValue = tiles.reduce((sum, tile) => sum + tile.value, 0);
  let otherBlockCount = 0;

  // Array order is the on-screen order (the shared builder sets `sort: false`).
  // Tie-break on name so a tie cannot fall back to input order — which is what
  // made the block order look different at 1600 and 390.
  const bySizeThenName = (a: SectorTreemapTile, b: SectorTreemapTile) =>
    b.value - a.value || a.name.localeCompare(b.name);

  const parents: SectorTreemapTile[] = Array.from(groups, ([name, members]) => {
    const sorted = [...members].sort(bySizeThenName);
    const shown = sorted.slice(0, stockCap);
    const tail = sorted.slice(stockCap);
    const children: SectorTreemapTile[] = shown.map((child) => ({
      ...child,
      label: {
        ...(child.label as Record<string, unknown> | undefined),
        // One gate for both lines: the symbol and value share this single
        // ECharts label object, so hiding it removes the whole block. The
        // tile's fill, tooltip datum and click target are untouched.
        show: stockTileLabelVisible(child.value, totalLeafValue, options?.width, options?.height),
        ...(narrow
          ? {
              // A short single-line symbol fits a narrow tile; the "name" datum
              // still carries the full symbol to the tooltip. The canvas spread
              // preserves both this formatter and `show` when it recolours.
              formatter: () => shortTreemapSymbol(child.name),
            }
          : {}),
      },
    }));

    if (tail.length) {
      otherBlockCount += 1;
      const badge = otherCompactLabel(tail.length);
      children.push({
        // Full identity stays on the datum for the tooltip; the painted label
        // is the short badge below, which survives a 4px tile.
        name: otherLabel(tail.length),
        value: tail.reduce((sum, child) => sum + child.value, 0),
        isOther: true,
        metricLabel: "Aggregate",
        metricValue: `${tail.length} stocks`,
        label: {
          show: true,
          // ECharts ellipsises by pixel width, which a formatter cannot read.
          // "+n" is short enough never to truncate into a bare "S…"; italic
          // text and a dashed neutral hairline mark it as an aggregate, not a
          // stock. The full "Other (n)" name remains in the tooltip.
          formatter: () => badge,
          fontStyle: "italic",
          color: parentLabelColor,
        },
        itemStyle: {
          color: parentFill,
          borderColor: boundary,
          borderWidth: 1,
          borderType: "dashed",
        },
      });
    }

    return {
      name,
      value: sorted.reduce((sum, child) => sum + child.value, 0),
      sectorParent: true,
      stockCount: sorted.length,
      children,
      // Sectors are labelled by upperLabel on level 1; the inherited leaf
      // formatter would otherwise print "Energy\n" with no metric value.
      label: { show: false, color: parentLabelColor },
      itemStyle: { color: parentFill },
    };
  }).sort(bySizeThenName);

  const flatLevels = flat.series[0].levels;
  const levels: unknown[] = Array.isArray(flatLevels) ? flatLevels : [];
  const option: SectorTreemapOption = {
    ...flat,
    series: [{
      ...flat.series[0],
      data: parents,
      // level 0 = hidden root, level 1 = sector parents, level 2 = stock leaves.
      levels: [
        levels[0] ?? { itemStyle: { borderWidth: 0, gapWidth: 0 } },
        {
          itemStyle: { borderColor: boundary, borderWidth: 1, gapWidth: 1 },
          upperLabel: {
            // At narrow widths a header overlaps its children — hide it rather
            // than draw unreadable text over the tiles (level 2 still labels).
            show: showSectorLabels,
            height: 18,
            color: parentLabelColor,
            fontWeight: "bold",
            formatter: "{b}",
          },
        },
        levels[1] ?? { itemStyle: { borderColor: boundary, borderWidth: 1, gapWidth: 0 } },
      ],
    }],
  };

  return { option, stockCount: tiles.length, sectorCount: parents.length, otherBlockCount };
}

/** Named label used by the nested map's "Other (n)" rollup. */
export function otherLabel(count: number): string {
  return `Other (${count})`;
}

/**
 * Painted label for the rollup. ECharts truncates by available pixels, so a
 * formatter cannot ask for more room: the badge must be short enough to read
 * inside a tiny tile. `+n` means "n more names in this sector".
 */
export function otherCompactLabel(count: number): string {
  return `+${count}`;
}
