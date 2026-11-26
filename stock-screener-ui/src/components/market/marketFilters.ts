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
  | "symbol_asc"
  | "volume_desc"
  | "value_traded_desc"
  | "range_vs_atr_desc"
  | "gap_desc"
  | "gap_asc"
  | "to_52w_high_desc"
  | "from_52w_low_asc";

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
  { value: "volume_desc", label: "Volume ↓" },
  { value: "value_traded_desc", label: "Value Traded ↓" },
  { value: "range_vs_atr_desc", label: "Range ÷ ATR ↓" },
  { value: "gap_desc", label: "Gap % ↓" },
  { value: "gap_asc", label: "Gap % ↑" },
  { value: "to_52w_high_desc", label: "To 52W High ↓" },
  { value: "from_52w_low_asc", label: "From 52W Low ↑" },
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
  /** Mover bounds mirrored from api/screener_api/dashboard.py. null = off. */
  gapMin: number | null;
  gapMax: number | null;
  rangeVsAtrMin: number | null;
  to52wHighMin: number | null;
  to52wHighMax: number | null;
  from52wLowMin: number | null;
  from52wLowMax: number | null;
  volumeMin: number | null;
  valueTradedMin: number | null;
  /** Value/fundamental bounds. Ratios and percentages are unit-neutral. */
  peMax: number | null;
  psMax: number | null;
  pbMax: number | null;
  roeMin: number | null;
  divYieldMin: number | null;
  fcfYieldMin: number | null;
  debtToEquityMax: number | null;
  revYoyMin: number | null;
  epsYoyMin: number | null;
  /**
   * Sector-relative gates, 0..1, "fraction of the row's own sector it beats":
   * 0 = best, 1 = worst. Preferred over the absolute bounds above for the
   * presets because a flat threshold means different things per sector and
   * rejects large caps on rounding (see `sectorPercentiles`).
   */
  pePctMax: number | null;
  roePctMin: number | null;
  dePctMax: number | null;
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
    gapMin: null,
    gapMax: null,
    rangeVsAtrMin: null,
    to52wHighMin: null,
    to52wHighMax: null,
    from52wLowMin: null,
    from52wLowMax: null,
    volumeMin: null,
    valueTradedMin: null,
    peMax: null,
    psMax: null,
    pbMax: null,
    roeMin: null,
    divYieldMin: null,
    fcfYieldMin: null,
    debtToEquityMax: null,
    revYoyMin: null,
    epsYoyMin: null,
    pePctMax: null,
    roePctMin: null,
    dePctMax: null,
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
  value: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined,
): boolean {
  const lo = has(min) ? min : null;
  const hi = has(max) ? max : null;
  if (lo === null && hi === null) return true;
  // A NaN row sits outside a bound no matter which way it is compared, so a
  // `value == null` check alone let stale cached prints survive every gate.
  if (!has(value)) return false;
  if (lo !== null && value < lo) return false;
  if (hi !== null && value > hi) return false;
  return true;
}

/* ── Sector-relative percentile gates ────────────────────────────────────────
 *
 * Absolute thresholds do not travel: a flat "ROE ≥ 15" rejects SBIN (ROE 14.58)
 * while admitting a small cap at ROE 4200% off a one-off gain, and the same
 * number means different things in Utilities and Technology. The value engine
 * this replaces solved that with percentile gates inside each row's own sector
 * bucket (api/value_scan/filters.py `_pct`, AGENTS.md "absolute thresholds do
 * not travel between markets").
 *
 * The market frame already carries `sector` on every row and has ~20 buckets
 * with ≥13 members each, so the same ranking is computable client-side against
 * the pre-gate frame — which is the requirement: peer medians must describe the
 * whole frame, never the surviving survivors, or the gate is self-referential.
 */

/** Which direction is "better" — a cheap multiple is low, a return is high. */
type PctDirection = "max" | "min";

interface PctMetricSpec {
  label: string;
  direction: PctDirection;
  value: (row: MarketRow) => number | null;
}

/** Every ranked metric the percentile gates can use. */
export const PCT_METRICS = {
  pe: { label: "P/E", direction: "max", value: (r) => r.peRatio },
  ps: { label: "P/S", direction: "max", value: (r) => r.psRatio },
  pb: { label: "P/B", direction: "max", value: (r) => r.pbRatio },
  roe: { label: "ROE", direction: "min", value: (r) => r.roe },
  de: { label: "D/E", direction: "max", value: (r) => r.debtToEquity },
  fcfYield: { label: "FCF yield", direction: "min", value: (r) => r.fcfYield },
  revYoy: { label: "Rev growth", direction: "min", value: (r) => r.revYoy },
  epsYoy: { label: "EPS growth", direction: "min", value: (r) => r.epsYoy },
  divYield: { label: "Div yield", direction: "min", value: (r) => r.dividendYield },
} as const satisfies Record<string, PctMetricSpec>;

export type PctMetricKey = keyof typeof PCT_METRICS;

/**
 * A bucket needs at least this many members before its ranking means anything.
 * Below it the metric is treated as UNAVAILABLE for the bucket and the gate is
 * skipped rather than guessed (mirrors MIN_METRIC_COVERAGE on the server).
 */
export const PCT_MIN_BUCKET = 5;

/**
 * Percentile rank inside the bucket, matching the retired engine exactly:
 * `count(v <= value) / n` — a plain ascending rank, **not** isolated to
 * "goodness". The gate then decides direction, so `roe_pct_min: 0.55` reads
 * "beats at least 55% of its sector" and `pe_pct_max: 0.35` reads "cheapest
 * 35%". Inverting the rank per metric here would silently flip every gate.
 */
function pctRank(sorted: number[], value: number): number {
  let atOrBelow = 0;
  for (const v of sorted) if (v <= value) atOrBelow++;
  return atOrBelow / sorted.length;
}

const sectorKey = (row: MarketRow): string => (row.sector ?? "").trim() || "Other";

/**
 * Percentile of each row within its sector bucket, per metric. Computed over the
 * FULL frame before any predicate runs, so filtering cannot change who counts as
 * a peer.
 */
export function sectorPercentiles(
  rows: readonly MarketRow[],
  keys: readonly PctMetricKey[],
): Map<MarketRow, Partial<Record<PctMetricKey, number>>> {
  const out = new Map<MarketRow, Partial<Record<PctMetricKey, number>>>();
  if (keys.length === 0) return out;

  // bucket -> metric -> sorted values, built once.
  const buckets = new Map<string, Map<PctMetricKey, number[]>>();
  for (const row of rows) {
    const key = sectorKey(row);
    let per = buckets.get(key);
    if (!per) {
      per = new Map();
      buckets.set(key, per);
    }
    for (const k of keys) {
      const v = PCT_METRICS[k].value(row);
      if (v === null || !Number.isFinite(v)) continue;
      let list = per.get(k);
      if (!list) {
        list = [];
        per.set(k, list);
      }
      list.push(v);
    }
  }
  for (const per of buckets.values()) {
    for (const list of per.values()) list.sort((a, b) => a - b);
  }

  for (const row of rows) {
    const per = buckets.get(sectorKey(row));
    const ranks: Partial<Record<PctMetricKey, number>> = {};
    for (const k of keys) {
      const v = PCT_METRICS[k].value(row);
      const list = per?.get(k);
      if (v === null || !Number.isFinite(v) || !list || list.length < PCT_MIN_BUCKET) continue;
      ranks[k] = pctRank(list, v);
    }
    out.set(row, ranks);
  }
  return out;
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
  volume_desc: (a, b) => (b.volume ?? -Infinity) - (a.volume ?? -Infinity),
  value_traded_desc: (a, b) => (b.valueTraded ?? -Infinity) - (a.valueTraded ?? -Infinity),
  range_vs_atr_desc: (a, b) => (b.rangeVsAtr ?? -Infinity) - (a.rangeVsAtr ?? -Infinity),
  gap_desc: (a, b) => (b.gap ?? -Infinity) - (a.gap ?? -Infinity),
  gap_asc: (a, b) => (a.gap ?? Infinity) - (b.gap ?? Infinity),
  to_52w_high_desc: (a, b) =>
    (b.to52wHighPct ?? -Infinity) - (a.to52wHighPct ?? -Infinity),
  from_52w_low_asc: (a, b) =>
    (a.from52wLowPct ?? Infinity) - (b.from52wLowPct ?? Infinity),
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
  // Rank BEFORE any predicate: peer medians must describe the whole frame, or
  // the gate becomes self-referential (AGENTS.md, Deep Value percentiles).
  const pctKeys: PctMetricKey[] = [];
  if (has(filters.pePctMax)) pctKeys.push("pe");
  if (has(filters.roePctMin)) pctKeys.push("roe");
  if (has(filters.dePctMax)) pctKeys.push("de");
  const pct = pctKeys.length > 0 ? sectorPercentiles(rows, pctKeys) : null;

  return rows.filter((row) => {
    if (pct) {
      const ranks = pct.get(row);
      // A percentile gate is active: an unranked row (thin sector, missing
      // metric) cannot be asserted against, so it fails rather than passes.
      if (has(filters.pePctMax)) {
        const v = ranks?.pe;
        if (v === undefined || v > filters.pePctMax!) return false;
      }
      if (has(filters.roePctMin)) {
        const v = ranks?.roe;
        if (v === undefined || v < filters.roePctMin!) return false;
      }
      if (has(filters.dePctMax)) {
        const v = ranks?.de;
        if (v === undefined || v > filters.dePctMax!) return false;
      }
    }
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
    if (!inRange(row.gap, filters.gapMin, filters.gapMax)) return false;
    if (!inRange(row.rangeVsAtr, filters.rangeVsAtrMin, null)) return false;
    if (!inRange(row.to52wHighPct, filters.to52wHighMin, filters.to52wHighMax)) return false;
    if (!inRange(row.from52wLowPct, filters.from52wLowMin, filters.from52wLowMax)) return false;
    if (!inRange(row.volume, filters.volumeMin, null)) return false;
    if (!inRange(row.valueTraded, filters.valueTradedMin, null)) return false;
    if (!inRange(row.peRatio, null, filters.peMax)) return false;
    if (!inRange(row.psRatio, null, filters.psMax)) return false;
    if (!inRange(row.pbRatio, null, filters.pbMax)) return false;
    if (!inRange(row.roe, filters.roeMin, null)) return false;
    if (!inRange(row.dividendYield, filters.divYieldMin, null)) return false;
    if (!inRange(row.fcfYield, filters.fcfYieldMin, null)) return false;
    if (!inRange(row.debtToEquity, null, filters.debtToEquityMax)) return false;
    if (!inRange(row.revYoy, filters.revYoyMin, null)) return false;
    if (!inRange(row.epsYoy, filters.epsYoyMin, null)) return false;
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
    // Mover bounds describe percentages, counts and multiples; the traded value
    // is read from the row's own currency, so none of them is universe-bound.
    gapMin: filters.gapMin,
    gapMax: filters.gapMax,
    rangeVsAtrMin: filters.rangeVsAtrMin,
    to52wHighMin: filters.to52wHighMin,
    to52wHighMax: filters.to52wHighMax,
    from52wLowMin: filters.from52wLowMin,
    from52wLowMax: filters.from52wLowMax,
    volumeMin: filters.volumeMin,
    valueTradedMin: filters.valueTradedMin,
    // Ratios and growth rates carry no currency/cap unit, so a universe switch
    // must not silently drop them.
    peMax: filters.peMax,
    psMax: filters.psMax,
    pbMax: filters.pbMax,
    roeMin: filters.roeMin,
    divYieldMin: filters.divYieldMin,
    fcfYieldMin: filters.fcfYieldMin,
    debtToEquityMax: filters.debtToEquityMax,
    revYoyMin: filters.revYoyMin,
    epsYoyMin: filters.epsYoyMin,
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

function boundChip(
  key: string,
  label: string,
  value: number | null | undefined,
  direction: "min" | "max",
  unit = "",
): MarketFilterChip | null {
  if (!has(value)) return null;
  return { key, label: `${label} ${direction === "min" ? "≥" : "≤"} ${fmtNum(value)}${unit}` };
}

/**
 * A percentile bound reads as a share of the row's own sector, not a number the
 * user can compare across sectors — so the chip says so explicitly.
 */
function pctChip(
  key: string,
  label: string,
  value: number | null | undefined,
  direction: "min" | "max",
): MarketFilterChip | null {
  if (!has(value)) return null;
  const pct = Math.round(value * 100);
  const text = direction === "min" ? `top ${100 - pct}%` : `cheapest ${pct}%`;
  return { key, label: `${label} ${text} of sector` };
}

/**
 * One-click bundle of three sector-relative gates. Every bound is an ascending
 * percentile inside the row's own sector bucket (see `sectorPercentiles`):
 * cheaper/leaner ranks low, stronger ROE ranks high. This is not a set of
 * absolute cutoffs — the same number means different things in Utilities and
 * Technology, so the gates are expressed relative to each row's peers.
 *
 * Measured on the live NSE frame, a flat `ROE ≥ 15` rejected SBIN (ROE 14.58)
 * and NTPC (14.66) — the two largest cheap banks/utilities in the index —
 * while admitting ROLLT at ROE 4200% off a one-off gain. It also halved the
 * large-cap matches (53 vs 106).
 *
 * `fcfYield` is deliberately absent: TradingView carries `free_cash_flow_ttm`
 * for only ~6% of Indian names (measured 3 of 50), so a gate on it narrows on
 * missing data, not on bad companies.
 */
export const DEEP_VALUE_PRESET: Pick<
  MarketFilterState,
  "pePctMax" | "roePctMin" | "dePctMax"
> = {
  /** Ascending rank, so ≤ 0.35 = the cheapest 35% of the row's own sector. */
  pePctMax: 0.35,
  /** Ascending rank, so ≥ 0.45 = beats 45% of its sector on ROE. */
  roePctMin: 0.45,
  /** Ascending rank, so ≤ 0.30 = the least-leveraged 30% of its sector. */
  dePctMax: 0.3,
};

export function deepValuePresetActive(filters: MarketFilterState): boolean {
  return (
    filters.pePctMax === DEEP_VALUE_PRESET.pePctMax &&
    filters.roePctMin === DEEP_VALUE_PRESET.roePctMin &&
    filters.dePctMax === DEEP_VALUE_PRESET.dePctMax
  );
}

/** Gate labels for the gallery, derived from the preset so a retune cannot lie. */
export const DEEP_VALUE_PRESET_CHIPS: readonly MarketFilterChip[] = [
  {
    key: "pePctMax",
    label: `P/E cheapest ${Math.round(DEEP_VALUE_PRESET.pePctMax! * 100)}%`,
  },
  {
    key: "roePctMin",
    label: `ROE top ${Math.round((1 - DEEP_VALUE_PRESET.roePctMin!) * 100)}%`,
  },
  {
    key: "dePctMax",
    label: `D/E least leveraged ${Math.round(DEEP_VALUE_PRESET.dePctMax! * 100)}%`,
  },
  { key: "sector", label: "Inside each row's own sector" },
];

/** The exact patch that undoes the Deep Value bundle, in one write. */
export function clearDeepValuePresetPatch(): Partial<MarketFilterState> {
  return { pePctMax: null, roePctMin: null, dePctMax: null };
}

/**
 * A descriptor is filters + sort: applying one click must be able to replace
 * the current ordering as well as the bounds (Most Active / Top Turnover are
 * only sorts in dashboard.py).
 */
export interface MoverPreset {
  id: string;
  label: string;
  description: string;
  filters: Partial<MarketFilterState>;
  sort: MarketSortKey;
}

/**
 * The Movers dashboard defaults to `min_market_cap_cr = 500`, so its boards
 * never show nano-caps. Without the same floor a preset is not a mirror of the
 * tab: measured on the live NSE frame, `gap >= 3` matches 132 rows across all
 * 3,593 but only 9 once the ₹500 Cr floor applies — the other 123 are ₹346-491 Cr
 * micro-caps. Every mover preset therefore carries this floor.
 */
export const MOVER_MIN_MCAP_CR = 500;

/**
 * Mirrors of the ten panels in api/screener_api/dashboard.py plus the two
 * "New 52W" panels in the daily-moves report (ReportMovePanels.tsx), which have
 * no dashboard card. Gainers, Losers, Most Active, Top Turnover and Range
 * Expansion have no numeric gate there — they are pure top-N sorts, so their
 * only bound is the shared market-cap floor and the description says so. All
 * twelve carry that ₹500 Cr floor via `filters.mcapMinCr`.
 */
export const MOVER_PRESETS: readonly MoverPreset[] = [
  {
    id: "gainers",
    label: "Top Gainers",
    description: "Pure top-N sort by day change — no threshold; every row is ranked highest first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR },
    sort: "day_desc",
  },
  {
    id: "losers",
    label: "Top Losers",
    description: "Pure top-N sort by day change — no threshold; every row is ranked lowest first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR },
    sort: "day_asc",
  },
  {
    id: "nearHigh",
    label: "Near 52W High",
    description: "Within -5% to +0.5% of the 52-week high, nearest to the high first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, to52wHighMin: -5, to52wHighMax: 0.5 },
    sort: "to_52w_high_desc",
  },
  {
    id: "newHigh",
    label: "New 52W High",
    description: "At or above the 52-week high — no upper bound — highest above the high first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, to52wHighMin: 0 },
    sort: "to_52w_high_desc",
  },
  {
    id: "nearLow",
    label: "Near 52W Low",
    description: "Within -0.5% to +5% of the 52-week low, nearest to the low first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, from52wLowMin: -0.5, from52wLowMax: 5 },
    sort: "from_52w_low_asc",
  },
  {
    id: "newLow",
    label: "New 52W Low",
    description: "At or below the 52-week low — no lower bound — lowest below the low first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, from52wLowMax: 0 },
    sort: "from_52w_low_asc",
  },
  {
    id: "volumeSurge",
    label: "Volume Surge",
    description: "Relative volume >= 3x, highest relative volume first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, relVolMin: 3 },
    sort: "relvol_desc",
  },
  {
    id: "mostActive",
    label: "Most Active",
    description: "Pure top-N sort by volume — no threshold; every row is ranked by volume descending.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR },
    sort: "volume_desc",
  },
  {
    id: "turnover",
    label: "Top Turnover",
    description: "Pure top-N sort by value traded — no threshold; every row is ranked by turnover descending.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR },
    sort: "value_traded_desc",
  },
  {
    id: "gapUp",
    label: "Gap Up",
    description: "Gap at open >= +3%, largest gap first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, gapMin: 3 },
    sort: "gap_desc",
  },
  {
    id: "gapDown",
    label: "Gap Down",
    description: "Gap at open <= -3%, largest down-gap first.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR, gapMax: -3 },
    sort: "gap_asc",
  },
  {
    id: "rangeExpansion",
    label: "Range Expansion",
    description: "Pure top-N sort by range ÷ ATR — no threshold; dashboard.py keeps every row with a usable ATR.",
    filters: { mcapMinCr: MOVER_MIN_MCAP_CR },
    sort: "range_vs_atr_desc",
  },
];

/**
 * Bounds any mover preset may set. A preset is a fresh screen, not an additive
 * filter: without clearing these, Gap Up followed by Top Gainers keeps the
 * previous `gapMin` (and 52W/rel-vol bounds) and the second preset returns a
 * misleading subset. Non-mover filters (sector, price, RSI, search) survive.
 */
export const MOVER_PRESET_FILTER_KEYS = [
  ...new Set(MOVER_PRESETS.flatMap((preset) => Object.keys(preset.filters))),
] as (keyof MarketFilterState)[];

/** Merge a mover patch, clearing only bounds owned by the previous mover preset. */
export function mergeMoverPresetFilters(
  filters: MarketFilterState,
  patch: Partial<MarketFilterState>,
): MarketFilterState {
  const moverKeys = new Set<string>(MOVER_PRESET_FILTER_KEYS);
  if (!Object.keys(patch).some((key) => moverKeys.has(key))) {
    return { ...filters, ...patch };
  }
  const cleared = Object.fromEntries(
    MOVER_PRESET_FILTER_KEYS.map((key) => [key, null]),
  ) as Partial<MarketFilterState>;
  return { ...filters, ...cleared, ...patch };
}

function patchActive(filters: MarketFilterState, patch: Partial<MarketFilterState>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    if ((filters as unknown as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}

/** The mover preset whose bounds AND sort are currently applied, if any. */
export function activeMoverPreset(filters: MarketFilterState): MoverPreset | null {
  for (const preset of MOVER_PRESETS) {
    if (filters.sort === preset.sort && patchActive(filters, preset.filters)) return preset;
  }
  return null;
}

/**
 * What a mover preset will actually change, as removable-chip labels. Sort is
 * included because a mover is a fresh screen, not just a set of bounds; the
 * preset's own chip is omitted — the card already identifies itself.
 */
export function moverPresetChips(preset: MoverPreset): MarketFilterChip[] {
  const state: MarketFilterState = { ...defaultMarketFilters(), ...preset.filters, sort: preset.sort };
  const chips = buildMarketFilterChips(state).filter((chip) => !chip.key.startsWith("mover:"));
  const sortLabel = MARKET_SORT_OPTIONS.find((option) => option.value === preset.sort)?.label;
  if (sortLabel) chips.push({ key: "sort", label: `Sort ${sortLabel}` });
  return chips;
}

/** The exact patch that undoes a mover preset's bounds and its ordering. */
export function clearMoverPresetPatch(preset: MoverPreset): Partial<MarketFilterState> {
  const bounds = Object.fromEntries(
    Object.keys(preset.filters).map((key) => [key, null]),
  ) as Partial<MarketFilterState>;
  return { ...bounds, sort: DEFAULT_MARKET_SORT };
}

/**
 * Removable chips for the active filters. Sort is a view control, not a
 * filter, so it is deliberately excluded — except as part of a mover preset,
 * whose single chip owns both the bounds and the ordering it replaced.
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
  push(rangeChip("gap", "Gap", filters.gapMin, filters.gapMax, "%"));
  push(boundChip("rangeVsAtr", "Range ÷ ATR", filters.rangeVsAtrMin, "min", "x"));
  push(rangeChip("to52wHigh", "To 52W high", filters.to52wHighMin, filters.to52wHighMax, "%"));
  push(rangeChip("from52wLow", "From 52W low", filters.from52wLowMin, filters.from52wLowMax, "%"));
  push(boundChip("volume", "Volume", filters.volumeMin, "min"));
  push(boundChip("valueTraded", "Value traded", filters.valueTradedMin, "min"));
  push(boundChip("pe", "P/E", filters.peMax, "max"));
  push(boundChip("ps", "P/S", filters.psMax, "max"));
  push(boundChip("pb", "P/B", filters.pbMax, "max"));
  push(boundChip("roe", "ROE", filters.roeMin, "min", "%"));
  push(boundChip("divYield", "Div yield", filters.divYieldMin, "min", "%"));
  push(boundChip("fcfYield", "FCF yield", filters.fcfYieldMin, "min", "%"));
  push(boundChip("debtToEquity", "D/E", filters.debtToEquityMax, "max"));
  push(boundChip("revYoy", "Rev growth", filters.revYoyMin, "min", "%"));
  push(boundChip("epsYoy", "EPS growth", filters.epsYoyMin, "min", "%"));
  // Percentile gates share one chip when the preset set all three, otherwise
  // each is removable on its own.
  const preset = deepValuePresetActive(filters);
  if (preset) {
    chips.push({ key: "deepValue", label: "Deep value preset" });
  } else {
    push(pctChip("pePct", "P/E", filters.pePctMax, "max"));
    push(pctChip("roePct", "ROE", filters.roePctMin, "min"));
    push(pctChip("dePct", "D/E", filters.dePctMax, "max"));
  }
  if (filters.aboveSma20) chips.push({ key: "sma20", label: "Above SMA 20" });
  if (filters.aboveSma50) chips.push({ key: "sma50", label: "Above SMA 50" });
  if (filters.aboveSma200) chips.push({ key: "sma200", label: "Above SMA 200" });
  if (filters.fnoOnly && universeHasFno(universe)) chips.push({ key: "fno", label: "F&O only" });
  for (const sector of filters.sectors) {
    if (!sector) continue;
    chips.push({ key: `sector:${sector}`, label: `Sector: ${sector}` });
  }

  const mover = activeMoverPreset(filters);
  if (mover) chips.push({ key: `mover:${mover.id}`, label: `${mover.label} preset` });

  return chips;
}

export function countActiveMarketFilters(
  filters: MarketFilterState,
  universe: MarketUniverse = "all_equity",
): number {
  return buildMarketFilterChips(filters, universe).length;
}

/**
 * Pure chip → state mapping. The panel's `removeChip` owns the same switch today;
 * routing it through this function keeps every chip (including the value bounds
 * and the preset) removable without a second hand-maintained key list.
 */
export function clearMarketFilterChip(
  filters: MarketFilterState,
  key: string,
): MarketFilterState {
  if (key === "search") return { ...filters, search: "" };
  if (key.startsWith("capTier:")) {
    const tier = key.slice("capTier:".length);
    const next = new Set(filters.capTiers);
    next.delete(tier);
    return { ...filters, capTiers: next };
  }
  if (key.startsWith("mover:")) {
    const preset = MOVER_PRESETS.find((p) => `mover:${p.id}` === key);
    if (!preset) return filters;
    return {
      ...filters,
      ...(Object.fromEntries(
        Object.keys(preset.filters).map((field) => [field, null]),
      ) as Partial<MarketFilterState>),
      sort: DEFAULT_MARKET_SORT,
    };
  }
  switch (key) {
    case "price":
      return { ...filters, priceMin: null, priceMax: null };
    case "day":
      return { ...filters, dayChangeMin: null, dayChangeMax: null };
    case "mcap":
      return { ...filters, mcapMinCr: null, mcapMaxCr: null };
    case "rsi":
      return { ...filters, rsiMin: null, rsiMax: null };
    case "relvol":
      return { ...filters, relVolMin: null, relVolMax: null };
    case "gap":
      return { ...filters, gapMin: null, gapMax: null };
    case "rangeVsAtr":
      return { ...filters, rangeVsAtrMin: null };
    case "to52wHigh":
      return { ...filters, to52wHighMin: null, to52wHighMax: null };
    case "from52wLow":
      return { ...filters, from52wLowMin: null, from52wLowMax: null };
    case "volume":
      return { ...filters, volumeMin: null };
    case "valueTraded":
      return { ...filters, valueTradedMin: null };
    case "pe":
      return { ...filters, peMax: null };
    case "ps":
      return { ...filters, psMax: null };
    case "pb":
      return { ...filters, pbMax: null };
    case "roe":
      return { ...filters, roeMin: null };
    case "divYield":
      return { ...filters, divYieldMin: null };
    case "fcfYield":
      return { ...filters, fcfYieldMin: null };
    case "debtToEquity":
      return { ...filters, debtToEquityMax: null };
    case "revYoy":
      return { ...filters, revYoyMin: null };
    case "epsYoy":
      return { ...filters, epsYoyMin: null };
    case "deepValue":
      return {
        ...filters,
        pePctMax: null,
        roePctMin: null,
        dePctMax: null,
      };
    case "pePct":
      return { ...filters, pePctMax: null };
    case "roePct":
      return { ...filters, roePctMin: null };
    case "dePct":
      return { ...filters, dePctMax: null };
    case "sma20":
      return { ...filters, aboveSma20: false };
    case "sma50":
      return { ...filters, aboveSma50: false };
    case "sma200":
      return { ...filters, aboveSma200: false };
    case "fno":
      return { ...filters, fnoOnly: false };
    case "sector":
      return { ...filters, sectors: [] };
    default:
      if (key.startsWith("sector:")) {
        const name = key.slice("sector:".length);
        return { ...filters, sectors: filters.sectors.filter((s) => s !== name) };
      }
      return filters;
  }
}
