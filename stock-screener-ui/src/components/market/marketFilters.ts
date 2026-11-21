import type { MarketRow, MarketUniverse } from "../../types/marketScreener";
import {
  CAP_TIER_KEYS,
  capTierLabel as descriptorCapTierLabel,
  marketCapOf,
  marketCapUnitLabel,
  marketUniverseDescriptor,
  type CapTierKey,
  type CapTierRange,
} from "../../config/marketUniverses";

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

/** Derived from the descriptor registries — never a second hand-maintained list. */
export const CAP_TIERS: readonly CapTierKey[] = CAP_TIER_KEYS;
export type CapTier = CapTierKey;

export interface MarketFilterState {
  search: string;
  /** Empty set = every tier. */
  capTiers: Set<string>;
  priceMin: number | null;
  priceMax: number | null;
  dayChangeMin: number | null;
  dayChangeMax: number | null;
  /**
   * Market cap range in the active universe's unit (₹ crore / $ billions).
   * The legacy field names stay on the v1 wire; the unit comes from the descriptor.
   */
  mcapMinCr: number | null;
  mcapMaxCr: number | null;
  rsiMin: number | null;
  rsiMax: number | null;
  relVolMin: number | null;
  relVolMax: number | null;
  aboveSma20: boolean;
  aboveSma50: boolean;
  aboveSma200: boolean;
  fnoOnly: boolean;
  /** Exact sector match set; empty = all sectors. */
  sectors: string[];
  sort: MarketSortKey;
}

/** The cap unit depends on the universe; every default below is unit-neutral today. */
export function defaultMarketFilters(
  universe: MarketUniverse = "all_equity",
): MarketFilterState {
  void universe;
  return {
    search: "",
    capTiers: new Set<string>(),
    priceMin: null,
    priceMax: null,
    dayChangeMin: null,
    dayChangeMax: null,
    mcapMinCr: null,
    mcapMaxCr: null,
    rsiMin: null,
    rsiMax: null,
    relVolMin: null,
    relVolMax: null,
    aboveSma20: false,
    aboveSma50: false,
    aboveSma200: false,
    fnoOnly: false,
    sectors: [],
    sort: DEFAULT_MARKET_SORT,
  };
}

const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);

function inRange(
  value: number | null,
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const lo = has(min) ? min : null;
  const hi = has(max) ? max : null;
  if (lo === null && hi === null) return true;
  if (value === null) return false;
  if (lo !== null && value < lo) return false;
  if (hi !== null && value > hi) return false;
  return true;
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
  // Reads the row's own currency, so a US snapshot sorts by $B even though the
  // filter field is still named mcapMinCr on the v1 wire.
  mcap_desc: (a, b) => (marketCapOf(b) ?? -Infinity) - (marketCapOf(a) ?? -Infinity),
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
    if (!inRange(marketCapOf(row), filters.mcapMinCr, filters.mcapMaxCr)) return false;
    if (!inRange(row.rsi, filters.rsiMin, filters.rsiMax)) return false;
    if (!inRange(row.relativeVolume, filters.relVolMin, filters.relVolMax)) return false;
    if (filters.aboveSma20 && !isAboveSma(row.close, row.sma20)) return false;
    if (filters.aboveSma50 && !isAboveSma(row.close, row.sma50)) return false;
    if (filters.aboveSma200 && !isAboveSma(row.close, row.sma200)) return false;
    if (filters.fnoOnly && !row.fno) return false;
    if (filters.sectors.length > 0 && !filters.sectors.includes(row.sector ?? "")) return false;
    return true;
  });
}

export function filterMarketRows(
  rows: MarketRow[],
  filters: MarketFilterState,
): MarketRow[] {
  return sortMarketRows(filterOnlyMarketRows(rows, filters), filters.sort);
}

/** Distinct, alphabetically sorted sectors present in the snapshot. Works for
 *  any universe — US sectors come from the loaded US rows, never India's list. */
export function marketSectors(rows: MarketRow[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.sector && row.sector.trim() !== "") seen.add(row.sector);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Select options built from the loaded rows for whichever universe is active. */
export function marketSectorOptions(rows: MarketRow[]): { value: string; label: string }[] {
  return marketSectors(rows).map((sector) => ({ value: sector, label: sector }));
}

export interface CapTierOption {
  value: CapTier;
  label: string;
  /** Class tiers are not size rungs; the rail renders them in their own group. */
  category: boolean;
}

/** Cap-tier labels from the descriptor: bare in India, thresholded in the US. */
export function capTierOptions(universe: MarketUniverse = "all_equity"): CapTierOption[] {
  const descriptor = marketUniverseDescriptor(universe);
  // Only tiers the active descriptor actually defines: India has no mega cap.
  return (Object.entries(descriptor.capTiers) as [CapTier, CapTierRange][]).map(
    ([tier, range]) => ({
      value: tier,
      label: descriptorCapTierLabel(tier, descriptor),
      category: range.category === true,
    }),
  );
}

/**
 * Universe switch: keep the unit-neutral conditions, drop every bound whose
 * unit/cap tier/sector vocabulary belonged to the previous universe.
 */
export function resetUniverseSpecificFilters(
  filters: MarketFilterState,
  universe: MarketUniverse,
): MarketFilterState {
  return {
    ...filters,
    ...defaultMarketFilters(universe),
    dayChangeMin: filters.dayChangeMin,
    dayChangeMax: filters.dayChangeMax,
    rsiMin: filters.rsiMin,
    rsiMax: filters.rsiMax,
    relVolMin: filters.relVolMin,
    relVolMax: filters.relVolMax,
    aboveSma20: filters.aboveSma20,
    aboveSma50: filters.aboveSma50,
    aboveSma200: filters.aboveSma200,
    // F&O is an NSE/BSE-only universe; a leftover switch would hide every US row.
    fnoOnly: false,
    sort: filters.sort,
  };
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

/**
 * F&O is an NSE/BSE instrument class — the US descriptor has no such universe.
 * Single source for the rail's toggle and the chip/count builders, so a saved
 * `fnoOnly: true` from an India session cannot surface as a dead US control.
 */
export function universeHasFno(universe: MarketUniverse = "all_equity"): boolean {
  return marketUniverseDescriptor(universe).currency !== "USD";
}

export interface MarketFilterChip {
  key: string;
  label: string;
}

/**
 * Total by construction: the filter state is `number | null`, but a caller that
 * writes `undefined` (or a stale persisted state) must not be able to throw
 * while rendering a chip — that blanks the whole panel behind the boundary.
 */
function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}


function rangeChip(
  key: string,
  label: string,
  min: number | null | undefined,
  max: number | null | undefined,
  unit = "",
): MarketFilterChip | null {
  const lo = has(min);
  const hi = has(max);
  if (!lo && !hi) return null;
  if (lo && hi) return { key, label: `${label} ${fmtNum(min)}–${fmtNum(max)}${unit}` };
  if (lo) return { key, label: `${label} ≥ ${fmtNum(min)}${unit}` };
  return { key, label: `${label} ≤ ${fmtNum(max)}${unit}` };
}

/**
 * Removable chips for the active filters. Sort is a view control, not a
 * filter, so it is deliberately excluded.
 */
export function buildMarketFilterChips(
  filters: MarketFilterState,
  universe: MarketUniverse = "all_equity",
): MarketFilterChip[] {
  const descriptor = marketUniverseDescriptor(universe);
  const chips: MarketFilterChip[] = [];
  const push = (chip: MarketFilterChip | null): void => {
    if (chip) chips.push(chip);
  };

  const search = filters.search.trim();
  if (search) chips.push({ key: "search", label: `Search: ${search}` });

  for (const tier of [...filters.capTiers].sort()) {
    chips.push({
      key: `capTier:${tier}`,
      label: `Cap: ${descriptorCapTierLabel(tier, descriptor)}`,
    });
  }

  push(rangeChip("price", "LTP", filters.priceMin, filters.priceMax, ""));
  push(rangeChip("day", "Day", filters.dayChangeMin, filters.dayChangeMax, "%"));
  push(
    rangeChip(
      "mcap",
      "MCap",
      filters.mcapMinCr,
      filters.mcapMaxCr,
      marketCapUnitLabel(descriptor),
    ),
  );
  push(rangeChip("rsi", "RSI", filters.rsiMin, filters.rsiMax, ""));
  push(rangeChip("relvol", "RelVol", filters.relVolMin, filters.relVolMax, ""));
  if (filters.aboveSma20) chips.push({ key: "sma20", label: "Above SMA 20" });
  if (filters.aboveSma50) chips.push({ key: "sma50", label: "Above SMA 50" });
  if (filters.aboveSma200) chips.push({ key: "sma200", label: "Above SMA 200" });
  if (filters.fnoOnly && universeHasFno(universe)) chips.push({ key: "fno", label: "F&O only" });
  for (const sector of filters.sectors) {
    if (!sector) continue;
    chips.push({ key: `sector:${sector}`, label: `Sector: ${sector}` });
  }

  return chips;
}

export function countActiveMarketFilters(
  filters: MarketFilterState,
  universe: MarketUniverse = "all_equity",
): number {
  return buildMarketFilterChips(filters, universe).length;
}
