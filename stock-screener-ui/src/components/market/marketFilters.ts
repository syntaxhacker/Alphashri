import type { MarketRow } from "../../types/marketScreener";

export type MarketSortKey =
  | "day_desc"
  | "day_asc"
  | "relvol_desc"
  | "mcap_desc"
  | "rsi_desc"
  | "perf_1m_desc"
  | "perf_w_desc"
  | "pos_52w_desc"
  | "symbol_asc";

export const DEFAULT_MARKET_SORT: MarketSortKey = "mcap_desc";

export const MARKET_SORT_OPTIONS: { value: MarketSortKey; label: string }[] = [
  { value: "day_desc", label: "Day % ↓" },
  { value: "day_asc", label: "Day % ↑" },
  { value: "relvol_desc", label: "Rel Volume ↓" },
  { value: "mcap_desc", label: "Market Cap ↓" },
  { value: "rsi_desc", label: "RSI ↓" },
  { value: "perf_1m_desc", label: "1M % ↓" },
  { value: "perf_w_desc", label: "1W % ↓" },
  { value: "pos_52w_desc", label: "52W Position ↓" },
  { value: "symbol_asc", label: "Symbol A–Z" },
];

export const CAP_TIERS = ["large", "mid", "small", "micro"] as const;
export type CapTier = (typeof CAP_TIERS)[number];
export const CAP_TIER_LABELS: Record<CapTier, string> = {
  large: "Large",
  mid: "Mid",
  small: "Small",
  micro: "Micro",
};

export interface MarketFilterState {
  search: string;
  /** Empty set = every tier. */
  capTiers: Set<string>;
  priceMin: number | null;
  priceMax: number | null;
  dayChangeMin: number | null;
  dayChangeMax: number | null;
  /** Minimum market cap, ₹ crore. */
  mcapMinCr: number | null;
  rsiMin: number | null;
  rsiMax: number | null;
  relVolMin: number | null;
  aboveSma20: boolean;
  aboveSma50: boolean;
  aboveSma200: boolean;
  fnoOnly: boolean;
  etfOnly: boolean;
  /** Exact sector match; null = all sectors. */
  sector: string | null;
  sort: MarketSortKey;
}

export function defaultMarketFilters(): MarketFilterState {
  return {
    search: "",
    capTiers: new Set<string>(),
    priceMin: null,
    priceMax: null,
    dayChangeMin: null,
    dayChangeMax: null,
    mcapMinCr: null,
    rsiMin: null,
    rsiMax: null,
    relVolMin: null,
    aboveSma20: false,
    aboveSma50: false,
    aboveSma200: false,
    fnoOnly: false,
    etfOnly: false,
    sector: null,
    sort: DEFAULT_MARKET_SORT,
  };
}

function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function minAtLeast(value: number | null, min: number | null): boolean {
  if (min === null) return true;
  return value !== null && value >= min;
}

function isAboveSma(close: number | null, sma: number | null): boolean {
  return close !== null && sma !== null && close > sma;
}

// Rows are treated as immutable; in-place mutation of a cached row would serve a
// stale haystack. When the snapshot refreshes, new row objects arrive and the
// WeakMap entry is rebuilt automatically.
const searchIndexCache = new WeakMap<MarketRow, string>();

function searchableText(row: MarketRow): string {
  const cached = searchIndexCache.get(row);
  if (cached !== undefined) return cached;
  const haystack = `${row.symbol} ${row.name} ${row.sector ?? ""}`.toLowerCase();
  searchIndexCache.set(row, haystack);
  return haystack;
}

const SORT_COMPARATORS: Record<MarketSortKey, (a: MarketRow, b: MarketRow) => number> = {
  day_desc: (a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity),
  day_asc: (a, b) => (a.change ?? Infinity) - (b.change ?? Infinity),
  relvol_desc: (a, b) => (b.relativeVolume ?? -Infinity) - (a.relativeVolume ?? -Infinity),
  mcap_desc: (a, b) => (b.marketCapCr ?? -Infinity) - (a.marketCapCr ?? -Infinity),
  rsi_desc: (a, b) => (b.rsi ?? -Infinity) - (a.rsi ?? -Infinity),
  perf_1m_desc: (a, b) => (b.perf1m ?? -Infinity) - (a.perf1m ?? -Infinity),
  perf_w_desc: (a, b) => (b.perfW ?? -Infinity) - (a.perfW ?? -Infinity),
  pos_52w_desc: (a, b) => (b.pos52w ?? -Infinity) - (a.pos52w ?? -Infinity),
  symbol_asc: (a, b) => a.symbol.localeCompare(b.symbol),
};

export function sortMarketRows(rows: MarketRow[], sort: MarketSortKey): MarketRow[] {
  return [...rows].sort(SORT_COMPARATORS[sort] ?? SORT_COMPARATORS.day_desc);
}

/**
 * Filter-only pass. No sort — callers that only need a row subset or a count
 * must not pay for the sort.
 */
export function filterOnlyMarketRows(
  rows: MarketRow[],
  filters: MarketFilterState,
): MarketRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (search) {
      if (!searchableText(row).includes(search)) return false;
    }
    if (filters.capTiers.size > 0) {
      const tier = (row.capTier ?? "").toLowerCase();
      if (!filters.capTiers.has(tier)) return false;
    }
    if (!inRange(row.close, filters.priceMin, filters.priceMax)) return false;
    if (!inRange(row.change, filters.dayChangeMin, filters.dayChangeMax)) return false;
    if (!minAtLeast(row.marketCapCr, filters.mcapMinCr)) return false;
    if (!inRange(row.rsi, filters.rsiMin, filters.rsiMax)) return false;
    if (!minAtLeast(row.relativeVolume, filters.relVolMin)) return false;
    if (filters.aboveSma20 && !isAboveSma(row.close, row.sma20)) return false;
    if (filters.aboveSma50 && !isAboveSma(row.close, row.sma50)) return false;
    if (filters.aboveSma200 && !isAboveSma(row.close, row.sma200)) return false;
    if (filters.fnoOnly && !row.fno) return false;
    if (filters.etfOnly && !row.etf) return false;
    if (filters.sector && row.sector !== filters.sector) return false;
    return true;
  });
}

export function filterMarketRows(
  rows: MarketRow[],
  filters: MarketFilterState,
): MarketRow[] {
  return sortMarketRows(filterOnlyMarketRows(rows, filters), filters.sort);
}

/** Distinct, alphabetically sorted sectors present in the snapshot. */
export function marketSectors(rows: MarketRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.sector && row.sector.trim() !== "") seen.add(row.sector);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Rows per cap tier ("large" | …), useful for the rail checkbox labels. */
export function countByCapTier(rows: MarketRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const tier = (row.capTier ?? "").toLowerCase();
    if (!tier) continue;
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

export interface MarketFilterChip {
  key: string;
  label: string;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function rangeChip(
  key: string,
  label: string,
  min: number | null,
  max: number | null,
  unit = "",
): MarketFilterChip | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null)
    return { key, label: `${label} ${fmtNum(min)}–${fmtNum(max)}${unit}` };
  if (min !== null) return { key, label: `${label} ≥ ${fmtNum(min)}${unit}` };
  return { key, label: `${label} ≤ ${fmtNum(max as number)}${unit}` };
}

/**
 * Removable chips for the active filters. Sort is a view control, not a
 * filter, so it is deliberately excluded.
 */
export function buildMarketFilterChips(filters: MarketFilterState): MarketFilterChip[] {
  const chips: MarketFilterChip[] = [];
  const push = (chip: MarketFilterChip | null): void => {
    if (chip) chips.push(chip);
  };

  const search = filters.search.trim();
  if (search) chips.push({ key: "search", label: `Search: ${search}` });

  for (const tier of [...filters.capTiers].sort()) {
    const label = CAP_TIER_LABELS[tier as CapTier] ?? tier;
    chips.push({ key: `capTier:${tier}`, label: `Cap: ${label}` });
  }

  push(rangeChip("price", "LTP", filters.priceMin, filters.priceMax, ""));
  push(rangeChip("day", "Day", filters.dayChangeMin, filters.dayChangeMax, "%"));
  if (filters.mcapMinCr !== null)
    chips.push({ key: "mcap", label: `MCap ≥ ${fmtNum(filters.mcapMinCr)} Cr` });
  push(rangeChip("rsi", "RSI", filters.rsiMin, filters.rsiMax, ""));
  if (filters.relVolMin !== null)
    chips.push({ key: "relvol", label: `RelVol ≥ ${fmtNum(filters.relVolMin)}` });
  if (filters.aboveSma20) chips.push({ key: "sma20", label: "Above SMA 20" });
  if (filters.aboveSma50) chips.push({ key: "sma50", label: "Above SMA 50" });
  if (filters.aboveSma200) chips.push({ key: "sma200", label: "Above SMA 200" });
  if (filters.fnoOnly) chips.push({ key: "fno", label: "F&O only" });
  if (filters.etfOnly) chips.push({ key: "etf", label: "ETF only" });
  if (filters.sector) chips.push({ key: "sector", label: `Sector: ${filters.sector}` });

  return chips;
}

export function countActiveMarketFilters(filters: MarketFilterState): number {
  return buildMarketFilterChips(filters).length;
}
