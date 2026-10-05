/**
 * `usePatternUrlSync` — keeps the `/patterns` view shareable by mirroring the
 * active universe, timeframe and filter rail into the URL query string.
 *
 * Short keys keep links compact:
 *   universe, tf, pattern (repeat), family (repeat), direction (repeat),
 *   status (repeat), quality, within, volume_confirmed, min_rr, base, range,
 *   gap52, pos, relvol, volm, from, to, sort, symbol (a lone `symbol=` is the singular symbol filter; repeated
 *   `symbol=` values are the multi-symbol filter), q, trendlines,
 *   compute_trendlines (`=0` only, when trendline computation is skipped).
 *
 * Reads the URL once on mount (so a bookmarked view is restored) and writes
 * non-default state back on change. After hydration it also adopts later URL
 * changes (back/forward navigation) that differ from what it last wrote. The
 * screener's `?screener=` param is left untouched — this hook only manages the
 * keys listed below.
 */

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { PatternFilters, TrendlinesView } from "../types/chartPatterns";
import { DEFAULT_PATTERN_FILTERS, DEFAULT_TIMEFRAME } from "../state/chartPatterns";

/** Parsed URL: active selection plus a partial filter patch (defaults omitted). */
export interface ParsedPatternParams {
  universe: string | null;
  timeframe: string | null;
  lookback: number | null;
  /** False when `compute_trendlines=0`; true when `=1`; null when omitted. */
  computeTrendlines: boolean | null;
  /** Active workspace tab (`scan`|`watch`); null when omitted (defaults to scan). */
  tab: "scan" | "watch" | null;
  filters: Partial<PatternFilters>;
}

/** State slice the hook serializes back into the URL. */
export interface PatternUrlState {
  universe: string;
  timeframe: string;
  lookbackBars: number | null;
  /** Omitted (compute) is the default; only `false` is written. */
  computeTrendlines?: boolean;
  /** Active workspace tab; only `watch` is written (`scan` is the default). */
  tab?: "scan" | "watch";
  filters: PatternFilters;
}

export interface UsePatternUrlSyncArgs extends PatternUrlState {
  setUniverse: (universe: string) => void;
  setTimeframe: (timeframe: string) => void;
  setLookbackBars: (bars: number | null) => void;
  /** Optional so existing call sites keep compiling; the container provides it. */
  setComputeTrendlines?: (value: boolean) => void;
  /** Optional; when provided the `tab` param round-trips through the URL. */
  setTab?: (tab: "scan" | "watch") => void;
  applyFilters: (filters: Partial<PatternFilters>) => void;
}

function numberOrNull(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the pattern-related query params into an active selection + filter
 * patch. Unknown/blank params are ignored; repeated keys map to array filters.
 * Blank `universe`/`tf` parse as null (no selection), never as "".
 */
export function parsePatternParams(params: URLSearchParams): ParsedPatternParams {
  const filters: Partial<PatternFilters> = {};

  const pattern = params.getAll("pattern").filter((v) => v !== "");
  if (pattern.length > 0) filters.pattern_id = pattern;
  const family = params.getAll("family").filter((v) => v !== "");
  if (family.length > 0) filters.family = family;
  const direction = params.getAll("direction").filter((v) => v !== "");
  if (direction.length > 0) filters.direction = direction;
  const status = params.getAll("status").filter((v) => v !== "");
  if (status.length > 0) filters.status = status;

  const quality = params.get("quality");
  if (quality) filters.quality = quality;

  const formedWithin = numberOrNull(params.get("within"));
  if (formedWithin != null) filters.formed_within_bars = formedWithin;
  const volumeConfirmed = params.get("volume_confirmed");
  if (volumeConfirmed === "true") filters.volume_confirmed = true;
  else if (volumeConfirmed === "false") filters.volume_confirmed = false;
  const minRr = numberOrNull(params.get("min_rr"));
  if (minRr != null) filters.min_rr = minRr;
  const minBaseDays = numberOrNull(params.get("base"));
  if (minBaseDays != null) filters.min_base_days = minBaseDays;
  const maxRangePct = numberOrNull(params.get("range"));
  if (maxRangePct != null) filters.max_range_pct = maxRangePct;
  const max52wGap = numberOrNull(params.get("gap52"));
  if (max52wGap != null) filters.max_52w_gap = max52wGap;
  const minRangePos = numberOrNull(params.get("pos"));
  if (minRangePos != null) filters.min_range_pos = minRangePos;
  const minRelVolume = numberOrNull(params.get("relvol"));
  if (minRelVolume != null) filters.min_rel_volume = minRelVolume;
  const minVolumeM = numberOrNull(params.get("volm"));
  if (minVolumeM != null) filters.min_volume_m = minVolumeM;

  const from = params.get("from");
  if (from) filters.from_date = from;
  const to = params.get("to");
  if (to) filters.to_date = to;

  const sort = params.get("sort");
  if (sort) filters.sort = sort;

  // One `symbol=` is the singular symbol filter; several are the multi-symbol
  // filter (mirrors how the API layer serializes them onto one key).
  const symbols = params.getAll("symbol").filter((v) => v !== "");
  if (symbols.length > 1) filters.symbols = symbols;
  else if (symbols.length === 1) filters.symbol = symbols[0];

  const q = params.get("q");
  if (q) filters.q = q;

  // View-only trendline filter: only known values are adopted; anything else
  // (including a stale/typo'd param) falls back to the default via omission.
  const trendlines = params.get("trendlines");
  if (
    trendlines === "both" ||
    trendlines === "support" ||
    trendlines === "resistance" ||
    trendlines === "none"
  ) {
    filters.trendlines = trendlines as TrendlinesView;
  }

  let lookback: number | null = null;
  const rawLookback = params.get("lookback");
  if (rawLookback != null && rawLookback !== "") {
    const n = Number.parseInt(rawLookback, 10);
    if (Number.isFinite(n)) lookback = n;
  }

  // Compute toggle: only `=0` (skip) is ever written; `=1` parses back for
  // robustness but is never produced by `buildPatternParams`.
  const rawCompute = params.get("compute_trendlines");
  const computeTrendlines =
    rawCompute === "0" || rawCompute === "false"
      ? false
      : rawCompute === "1" || rawCompute === "true"
        ? true
        : null;

  return {
    universe: params.get("universe") || null,
    timeframe: params.get("tf") || null,
    lookback,
    computeTrendlines,
    tab: params.get("tab") === "watch" ? "watch" : params.get("tab") === "scan" ? "scan" : null,
    filters,
  };
}

/**
 * Serialize state into compact query params, omitting empty/default values so a
 * clean view produces a clean URL (no `?tf=1D` noise).
 */
export function buildPatternParams(state: PatternUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const { filters } = state;

  if (state.universe) params.set("universe", state.universe);
  if (state.timeframe && state.timeframe !== DEFAULT_TIMEFRAME) {
    params.set("tf", state.timeframe);
  }
  if (state.lookbackBars != null) {
    params.set("lookback", String(state.lookbackBars));
  }

  for (const id of filters.pattern_id ?? []) params.append("pattern", id);
  for (const id of filters.family ?? []) params.append("family", id);
  for (const id of filters.direction ?? []) params.append("direction", id);
  for (const id of filters.status ?? []) params.append("status", id);

  if (filters.quality) params.set("quality", filters.quality);
  if (filters.formed_within_bars != null) {
    params.set("within", String(filters.formed_within_bars));
  }
  if (filters.volume_confirmed != null) {
    params.set("volume_confirmed", String(filters.volume_confirmed));
  }
  if (filters.min_rr != null) params.set("min_rr", String(filters.min_rr));
  if (filters.min_base_days != null) params.set("base", String(filters.min_base_days));
  if (filters.max_range_pct != null) params.set("range", String(filters.max_range_pct));
  if (filters.max_52w_gap != null) params.set("gap52", String(filters.max_52w_gap));
  if (filters.min_range_pos != null) params.set("pos", String(filters.min_range_pos));
  if (filters.min_rel_volume != null) params.set("relvol", String(filters.min_rel_volume));
  if (filters.min_volume_m != null) params.set("volm", String(filters.min_volume_m));
  if (filters.from_date) params.set("from", filters.from_date);
  if (filters.to_date) params.set("to", filters.to_date);
  if (filters.sort && filters.sort !== DEFAULT_PATTERN_FILTERS.sort) {
    params.set("sort", filters.sort);
  }
  if (filters.symbol) params.set("symbol", filters.symbol);
  for (const symbol of filters.symbols ?? []) params.append("symbol", symbol);
  if (filters.q) params.set("q", filters.q);
  // View-only: written only when it narrows the default "both" view.
  if (filters.trendlines && filters.trendlines !== DEFAULT_PATTERN_FILTERS.trendlines) {
    params.set("trendlines", filters.trendlines);
  }
  // Compute toggle: only the opt-out (`false`) is written; compute is default.
  if (state.computeTrendlines === false) {
    params.set("compute_trendlines", "0");
  }
  // Workspace tab: only `watch` is written; `scan` is the default view.
  if (state.tab === "watch") {
    params.set("tab", "watch");
  }

  return params;
}

/** Query keys this hook owns; everything else is left untouched on write. */
const PATTERN_PARAM_KEYS = new Set([
  "universe",
  "tf",
  "lookback",
  "pattern",
  "family",
  "direction",
  "status",
  "quality",
  "within",
  "volume_confirmed",
  "min_rr",
  "base",
  "range",
  "gap52",
  "pos",
  "relvol",
  "volm",
  "from",
  "to",
  "sort",
  "symbol",
  "q",
  "trendlines",
  "compute_trendlines",
  "tab",
]);

/** True when a parsed URL actually carries any pattern param. */
function hasAnyPatternParam(parsed: ParsedPatternParams): boolean {
  return (
    parsed.universe != null ||
    parsed.timeframe != null ||
    parsed.lookback != null ||
    parsed.computeTrendlines != null ||
    parsed.tab != null ||
    Object.keys(parsed.filters).length > 0
  );
}

/**
 * Order-insensitive filter-value comparison: `["TCS","SBIN"]` and
 * `["SBIN","TCS"]` select the same symbols, so reordered repeats must count as
 * "already in sync" (otherwise hydration gates stall and writes loop).
 */
export function filterValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sortedA = [...a].map(String).sort();
    const sortedB = [...b].map(String).sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
  return a === b;
}

/**
 * Sync the pattern view with the URL. Call from `PatternsContainer` with the
 * store state and setters from `useChartPatterns`.
 */
export function usePatternUrlSync({
  universe,
  timeframe,
  lookbackBars,
  computeTrendlines,
  tab,
  filters,
  setUniverse,
  setTimeframe,
  setLookbackBars,
  setComputeTrendlines,
  setTab,
  applyFilters,
}: UsePatternUrlSyncArgs): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const didReadRef = useRef(false);
  // Parsed selection from the initial URL (null when the URL carried none).
  const parsedRef = useRef<ParsedPatternParams | null>(null);
  // Becomes true once the store has adopted the parsed selection, so the first
  // write reflects the applied state instead of clobbering the incoming params.
  const hydratedRef = useRef(false);
  // Skip the very first write commit (initial defaults) — only real changes write.
  const firstRunRef = useRef(true);
  // Serialized URL this hook last wrote (or last observed). A `searchParams`
  // change to anything else is external navigation (back/forward, manual edit)
  // and must be adopted rather than clobbered.
  const lastWrittenRef = useRef<string | null>(null);

  useEffect(() => {
    if (didReadRef.current) return;
    didReadRef.current = true;

    const parsed = parsePatternParams(searchParams);
    if (!hasAnyPatternParam(parsed)) {
      hydratedRef.current = true;
      return;
    }

    parsedRef.current = parsed;
    if (parsed.universe) setUniverse(parsed.universe);
    if (parsed.timeframe) setTimeframe(parsed.timeframe);
    if (parsed.lookback != null) setLookbackBars(parsed.lookback);
    if (parsed.computeTrendlines != null) setComputeTrendlines?.(parsed.computeTrendlines);
    if (parsed.tab != null) setTab?.(parsed.tab);
    if (Object.keys(parsed.filters).length > 0) applyFilters(parsed.filters);
    // Intentionally mount-only: read the URL once, then let changes write back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (firstRunRef.current) {
      firstRunRef.current = false;
      return;
    }
    if (!hydratedRef.current) {
      const parsed = parsedRef.current;
      if (!parsed) {
        hydratedRef.current = true;
      } else {
        const universeOk = !parsed.universe || universe === parsed.universe;
        const timeframeOk = !parsed.timeframe || timeframe === parsed.timeframe;
        const lookbackOk = parsed.lookback == null || lookbackBars === parsed.lookback;
        const computeOk =
          parsed.computeTrendlines == null ||
          (computeTrendlines ?? true) === parsed.computeTrendlines;
        const tabOk = parsed.tab == null || (tab ?? "scan") === parsed.tab;
        const filtersOk = Object.entries(parsed.filters).every(([key, value]) => {
          const current = (filters as Record<string, unknown>)[key];
          return filterValuesEqual(current, value);
        });
        if (!(universeOk && timeframeOk && lookbackOk && computeOk && tabOk && filtersOk)) return; // wait for adoption
        hydratedRef.current = true;
      }
    }

    const next = buildPatternParams({ universe, timeframe, lookbackBars, computeTrendlines, tab, filters });
    // Preserve unrelated params (e.g. the screener's `?screener=`) untouched.
    for (const [key, value] of searchParams.entries()) {
      if (!PATTERN_PARAM_KEYS.has(key)) next.append(key, value);
    }
    const nextString = next.toString();
    lastWrittenRef.current = nextString;
    if (nextString === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
    // Intentionally keyed on the synced state; `searchParams`/`setSearchParams`
    // are read imperatively and would re-trigger on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, timeframe, lookbackBars, computeTrendlines, tab, filters]);

  // Back/forward (or manual) navigation: once hydrated, adopt a URL that
  // differs from what this hook last wrote. Setter calls are diffed against
  // current state so adopting an equivalent URL is a no-op, and the write
  // effect above converges instead of looping (`next === searchParams`).
  useEffect(() => {
    if (!hydratedRef.current) return;
    const current = searchParams.toString();
    if (current === lastWrittenRef.current) return;
    lastWrittenRef.current = current;

    const parsed = parsePatternParams(searchParams);
    if (parsed.universe && parsed.universe !== universe) setUniverse(parsed.universe);
    if (parsed.timeframe && parsed.timeframe !== timeframe) setTimeframe(parsed.timeframe);
    if ((parsed.lookback ?? null) !== (lookbackBars ?? null)) {
      setLookbackBars(parsed.lookback);
    }
    if (parsed.computeTrendlines != null && parsed.computeTrendlines !== (computeTrendlines ?? true)) {
      setComputeTrendlines?.(parsed.computeTrendlines);
    }
    if (parsed.tab != null && parsed.tab !== (tab ?? "scan")) {
      setTab?.(parsed.tab);
    }
    const entries = Object.entries(parsed.filters);
    if (entries.length > 0) {
      const differs = entries.some(([key, value]) => {
        const currentValue = (filters as Record<string, unknown>)[key];
        return !filterValuesEqual(currentValue, value);
      });
      if (differs) applyFilters(parsed.filters);
    }
    // Intentionally keyed on the URL; state/setters are read imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
}
