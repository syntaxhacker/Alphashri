/**
 * Currency descriptors for the markets the app screens.
 *
 * The shared formatters used to embed the rupee symbol directly, so a USD row
 * rendered in rupees. Symbols, digit grouping, mcap units and compact suffixes
 * live here so a row's `currency` can drive every formatted number.
 */

export type CurrencyCode = "INR" | "USD";
/** Headline market-cap unit suffixes shared with the universe descriptors. */
export type McapSuffix = "Cr" | "B";

export type CompactFormatter = (value: number) => string;
export type FixedFormatter = (value: number, precision: number) => string;

/** One rung of a compact ladder: minimum raw value and the suffix it carries. */
export interface CompactUnit {
  min: number;
  suffix: string;
}

export interface CurrencySpec {
  code: CurrencyCode;
  symbol: string;
  grouping: "en-IN" | "en-US";
  /** Divisor that turns a raw amount into the market's headline mcap unit. */
  mcapScale: number;
  /** Suffix for that headline mcap unit. */
  mcapSuffix: McapSuffix;
  /** Compact ladder WITHOUT the symbol — `1.0Cr`, `1.5L`, `1.0K` / `1.0B`, `1.2M`, `1.0K`. */
  compactUnits: ReadonlyArray<CompactUnit>;
  compact: CompactFormatter;
  /**
   * Market-cap table cell. Deliberately NOT `compact`: India stops at lakh with
   * a lowercase `k` and rounds sub-threshold values; the US keeps the symbol
   * and locale grouping (`$12,345.7B`, `$12B`). Owned here so the table never
   * restates magic thresholds — the difference is encoded as descriptor data.
   */
  formatMcapCompact: CompactFormatter;
  /** Fixed-decimal number WITHOUT the symbol. */
  formatFixed: FixedFormatter;
  /** Locale-grouped fixed-decimal number WITHOUT the symbol. */
  formatGrouped: FixedFormatter;
}

const INR_GROUPING = "en-IN";
const USD_GROUPING = "en-US";
const INR_SYMBOL = "₹";
const USD_SYMBOL = "$";
const INR_MCAP_SUFFIX = "Cr";
const USD_MCAP_SUFFIX = "B";

const isUsable = (value: number): boolean => value != null && !Number.isNaN(value);

const groupedFixed = (grouping: "en-IN" | "en-US"): FixedFormatter => (value, precision) =>
  value.toLocaleString(grouping, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });

const inrGrouped = groupedFixed(INR_GROUPING);
const usdGrouped = groupedFixed(USD_GROUPING);

const INR_COMPACT_UNITS: ReadonlyArray<CompactUnit> = [
  { min: 1e7, suffix: "Cr" },
  { min: 1e5, suffix: "L" },
  { min: 1e3, suffix: "K" },
];

const USD_COMPACT_UNITS: ReadonlyArray<CompactUnit> = [
  { min: 1e9, suffix: "B" },
  { min: 1e6, suffix: "M" },
  { min: 1e3, suffix: "K" },
];

/** Compact ladder shared by both currencies: signed, one decimal, no symbol. */
const compactFrom = (units: ReadonlyArray<CompactUnit>): CompactFormatter => (value) => {
  if (!isUsable(value)) return "0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  for (const { min, suffix } of units) {
    if (abs >= min) return `${sign}${(abs / min).toFixed(1)}${suffix}`;
  }
  return `${sign}${abs.toFixed(0)}`;
};

/** Market-cap ladder for India: stops at lakh (no Cr rung) and uses lowercase `k`. */
const INR_MCAP_COMPACT_UNITS: ReadonlyArray<CompactUnit> = [
  { min: 1e5, suffix: "L" },
  { min: 1e3, suffix: "k" },
];

/**
 * Market-cap cell built from its ladder. Unlike `compact` this scales the
 * signed value, so negatives never reach a rung, and rounds sub-threshold
 * values with `Math.round` — both preserve the legacy table output.
 */
const mcapCompactFrom = (units: ReadonlyArray<CompactUnit>): CompactFormatter => (value) => {
  for (const { min, suffix } of units) {
    if (value >= min) return `${(value / min).toFixed(1)}${suffix}`;
  }
  return String(Math.round(value));
};

/** US market-cap cell: grouped, symbol-prefixed, no forced decimal (`$12B`). */
const usdMcapCompact: CompactFormatter = (value) =>
  `${USD_SYMBOL}${value.toLocaleString(USD_GROUPING, {
    maximumFractionDigits: 1,
  })}${USD_MCAP_SUFFIX}`;

export const CURRENCIES: Record<CurrencyCode, CurrencySpec> = {
  INR: {
    code: "INR",
    symbol: INR_SYMBOL,
    grouping: INR_GROUPING,
    mcapScale: 1e7,
    mcapSuffix: INR_MCAP_SUFFIX,
    compactUnits: INR_COMPACT_UNITS,
    compact: compactFrom(INR_COMPACT_UNITS),
    formatMcapCompact: mcapCompactFrom(INR_MCAP_COMPACT_UNITS),
    // Legacy INR output is ungrouped (`₹1234.57`) — keep it byte-identical.
    formatFixed: (value, precision) => value.toFixed(precision),
    formatGrouped: inrGrouped,
  },
  USD: {
    code: "USD",
    symbol: USD_SYMBOL,
    grouping: USD_GROUPING,
    mcapScale: 1e9,
    mcapSuffix: USD_MCAP_SUFFIX,
    compactUnits: USD_COMPACT_UNITS,
    compact: compactFrom(USD_COMPACT_UNITS),
    formatMcapCompact: usdMcapCompact,
    formatFixed: usdGrouped,
    formatGrouped: usdGrouped,
  },
};

/**
 * Resolve a market's currency string to its descriptor. Anything unrecognised
 * (including null/undefined) falls back to INR, the app's default quote currency.
 */
export function currencyFor(code?: string | null): CurrencySpec {
  const key = code?.trim().toUpperCase();
  if (key === "USD" || key === "$") return CURRENCIES.USD;
  return CURRENCIES.INR;
}
