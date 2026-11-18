/**
 * One descriptor per market universe. Per-universe config lives here — except
 * currency symbol, grouping locale and cap suffix, which are derived from the
 * `CURRENCIES` registry so `$`/`₹`/`en-US`/`en-IN` are never restated. Components
 * read the descriptor (or the row's own currency) instead of branching on the
 * universe name.
 *
 * Mirrors `api/market_screen/config.py`: India universes are rank-tiered in
 * ₹ crore; the US universe is absolute-tiered in $ billions.
 */

import type { MarketRow, MarketUniverse } from "../types/marketScreener";
import { CURRENCIES, currencyFor } from "./currency";

export type MarketCurrency = "INR" | "USD";
export type MarketCapUnit = "Cr" | "B";
export type MarketCapField = "marketCapCr" | "marketCapUsdB";
export type CapTierKey = "mega" | "large" | "mid" | "small" | "micro";

/** Bounds are in the descriptor's cap unit. `null` means unbounded on that side. */
export interface CapTierRange {
  /** Inclusive lower bound. */
  min: number | null;
  /** Exclusive upper bound. */
  max: number | null;
}

export interface MarketUniverseDescriptor {
  value: MarketUniverse;
  label: string;
  currency: MarketCurrency;
  currencySymbol: string;
  capUnit: MarketCapUnit;
  /** BCP 47 tag used for every grouped number in the universe. */
  priceLocale: string;
  /** Which MarketRow field carries this universe's market cap. */
  mcapField: MarketCapField;
  /** Cap-tier thresholds, descending. Indian tiers are rank-based → no bounds. */
  capTiers: Readonly<Partial<Record<CapTierKey, CapTierRange>>>;
}

const RANK_TIERS: Readonly<Partial<Record<CapTierKey, CapTierRange>>> = {
  large: { min: null, max: null },
  mid: { min: null, max: null },
  small: { min: null, max: null },
  micro: { min: null, max: null },
};

/** US absolute caps in $B: ≥200 mega, 10–200 large, 2–10 mid, 0.3–2 small, <0.3 micro. */
const USD_TIERS: Readonly<Partial<Record<CapTierKey, CapTierRange>>> = {
  mega: { min: 200, max: null },
  large: { min: 10, max: 200 },
  mid: { min: 2, max: 10 },
  small: { min: 0.3, max: 2 },
  micro: { min: null, max: 0.3 },
};

const INDIA = {
  currency: CURRENCIES.INR.code,
  currencySymbol: CURRENCIES.INR.symbol,
  capUnit: CURRENCIES.INR.mcapSuffix,
  priceLocale: CURRENCIES.INR.grouping,
  mcapField: "marketCapCr" as const,
  capTiers: RANK_TIERS,
};

export const MARKET_UNIVERSE_DESCRIPTORS: readonly MarketUniverseDescriptor[] = [
  { value: "all_equity", label: "All NSE", ...INDIA },
  { value: "nifty500", label: "Nifty 500", ...INDIA },
  { value: "nifty50", label: "Nifty 50", ...INDIA },
  { value: "nifty100", label: "NIFTY 100", ...INDIA },
  { value: "nifty200", label: "NIFTY 200", ...INDIA },
  { value: "banknifty", label: "Bank Nifty", ...INDIA },
  { value: "sensex", label: "Sensex", ...INDIA },
  { value: "nse_fo", label: "F&O", ...INDIA },
  {
    value: "us",
    label: "USA",
    currency: CURRENCIES.USD.code,
    currencySymbol: CURRENCIES.USD.symbol,
    capUnit: CURRENCIES.USD.mcapSuffix,
    priceLocale: CURRENCIES.USD.grouping,
    mcapField: "marketCapUsdB",
    capTiers: USD_TIERS,
  },
];

const BY_VALUE = new Map<MarketUniverse, MarketUniverseDescriptor>(
  MARKET_UNIVERSE_DESCRIPTORS.map((descriptor) => [descriptor.value, descriptor]),
);

/** Unknown/legacy values fall back to India so an old payload still reads. */
export function marketUniverseDescriptor(
  universe: MarketUniverse | string | null | undefined,
): MarketUniverseDescriptor {
  return (typeof universe === "string" ? BY_VALUE.get(universe as MarketUniverse) : undefined) ??
    MARKET_UNIVERSE_DESCRIPTORS[0];
}

/** Rows carry their own currency — the cell never has to ask which tab it is on. */
export function descriptorForCurrency(
  currency: string | null | undefined,
): MarketUniverseDescriptor {
  return currency === "USD"
    ? marketUniverseDescriptor("us")
    : MARKET_UNIVERSE_DESCRIPTORS[0];
}

/** Native market cap of a row in its universe's unit. */
export function marketCapOf(
  row: Pick<MarketRow, "marketCapCr" | "marketCapUsdB"> & { currency?: string | null },
  descriptor: MarketUniverseDescriptor = descriptorForCurrency(row.currency),
): number | null {
  const value = row[descriptor.mcapField];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Compact table value: `18.1L` / `1.5k` / `999` (India), `$12.3B` (US).
 * The ladder and its intentional divergence from `CURRENCIES.compact` live in
 * the currency descriptor; this function only owns the missing-value glyph.
 */
export function formatMarketCap(
  value: number | null,
  descriptor: MarketUniverseDescriptor,
): string {
  if (value === null) return "–";
  return currencyFor(descriptor.currency).formatMcapCompact(value);
}

/** Exact tooltip/aria value: `₹18,12,819 Cr` (India), `$12,345.7B` (US). */
export function marketCapLabel(
  value: number,
  descriptor: MarketUniverseDescriptor,
): string {
  if (descriptor.currency === "INR") {
    return `${descriptor.currencySymbol}${Math.round(value).toLocaleString(descriptor.priceLocale)} ${descriptor.capUnit}`;
  }
  return `${descriptor.currencySymbol}${value.toLocaleString(descriptor.priceLocale, {
    maximumFractionDigits: 1,
  })}${descriptor.capUnit}`;
}

/** Filter-bound/chip unit: ` Cr` (India) / ` B` (US). */
export function marketCapUnitLabel(descriptor: MarketUniverseDescriptor): string {
  return ` ${descriptor.capUnit}`;
}

function tierBound(bound: number, descriptor: MarketUniverseDescriptor): string {
  return `${bound}${descriptor.capUnit}`;
}

/** India keeps its bare labels; US labels carry the descriptor's thresholds. */
export function capTierLabel(tier: string, descriptor: MarketUniverseDescriptor): string {
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  const range = descriptor.capTiers[tier as CapTierKey];
  if (!range || (range.min === null && range.max === null)) return name;
  if (range.min !== null && range.max !== null) {
    return `${name} ${range.min}–${tierBound(range.max, descriptor)}`;
  }
  if (range.min !== null) return `${name} ≥${tierBound(range.min, descriptor)}`;
  return `${name} <${tierBound(range.max!, descriptor)}`;
}

/** Grouped price with the universe's locale — no symbol, so callers add it. */
export function formatPrice(
  value: number,
  descriptor: MarketUniverseDescriptor,
): string {
  return currencyFor(descriptor.currency).formatGrouped(value, 2);
}
