/**
 * `usePatternUrlSync` — keeps the `/patterns` view shareable by mirroring the
 * active universe, timeframe and filter rail into the URL query string.
 *
 * Short keys keep links compact:
 *   universe, tf, pattern (repeat), family (repeat), direction (repeat),
 *   status (repeat), quality, within, base, range, sort, symbol (repeat), q.
 *
 * Reads the URL once on mount (so a bookmarked view is restored) and writes
 * non-default state back on change. The screener's `?screener=` param is left
 * untouched — this hook only manages the keys listed above.
 */

import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { PatternFilters } from "../types/chartPatterns";
import { DEFAULT_PATTERN_FILTERS, DEFAULT_TIMEFRAME } from "../state/chartPatterns";

/** Parsed URL: active selection plus a partial filter patch (defaults omitted). */
export interface ParsedPatternParams {
  universe: string | null;
  timeframe: string | null;
  filters: Partial<PatternFilters>;
}

/** State slice the hook serializes back into the URL. */
export interface PatternUrlState {
  universe: string;
  timeframe: string;
  filters: PatternFilters;
}

export interface UsePatternUrlSyncArgs extends PatternUrlState {
  setUniverse: (universe: string) => void;
  setTimeframe: (timeframe: string) => void;
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
 */
export function parsePatternParams(params: URLSearchParams): ParsedPatternParams {
  const filters: Partial<PatternFilters> = {};

  const pattern = params.getAll("pattern");
  if (pattern.length > 0) filters.pattern_id = pattern;
  const family = params.getAll("family");
  if (family.length > 0) filters.family = family;
  const direction = params.getAll("direction");
  if (direction.length > 0) filters.direction = direction;
  const status = params.getAll("status");
  if (status.length > 0) filters.status = status;

  const quality = params.get("quality");
  if (quality) filters.quality = quality;

  const formedWithin = numberOrNull(params.get("within"));
  if (formedWithin != null) filters.formed_within_bars = formedWithin;
  const minBaseDays = numberOrNull(params.get("base"));
  if (minBaseDays != null) filters.min_base_days = minBaseDays;
  const maxRangePct = numberOrNull(params.get("range"));
  if (maxRangePct != null) filters.max_range_pct = maxRangePct;

  const sort = params.get("sort");
  if (sort) filters.sort = sort;

  const symbols = params.getAll("symbol");
  if (symbols.length > 0) filters.symbols = symbols;

  const q = params.get("q");
  if (q) filters.q = q;

  return {
    universe: params.get("universe"),
    timeframe: params.get("tf"),
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

  for (const id of filters.pattern_id ?? []) params.append("pattern", id);
  for (const id of filters.family ?? []) params.append("family", id);
  for (const id of filters.direction ?? []) params.append("direction", id);
  for (const id of filters.status ?? []) params.append("status", id);

  if (filters.quality) params.set("quality", filters.quality);
  if (filters.formed_within_bars != null) {
    params.set("within", String(filters.formed_within_bars));
  }
  if (filters.min_base_days != null) params.set("base", String(filters.min_base_days));
  if (filters.max_range_pct != null) params.set("range", String(filters.max_range_pct));
  if (filters.sort && filters.sort !== DEFAULT_PATTERN_FILTERS.sort) {
    params.set("sort", filters.sort);
  }
  for (const symbol of filters.symbols ?? []) params.append("symbol", symbol);
  if (filters.q) params.set("q", filters.q);

  return params;
}

/** Query keys this hook owns; everything else is left untouched on write. */
const PATTERN_PARAM_KEYS = new Set([
  "universe",
  "tf",
  "pattern",
  "family",
  "direction",
  "status",
  "quality",
  "within",
  "base",
  "range",
  "sort",
  "symbol",
  "q",
]);

/** True when a parsed URL actually carries any pattern param. */
function hasAnyPatternParam(parsed: ParsedPatternParams): boolean {
  return (
    parsed.universe != null ||
    parsed.timeframe != null ||
    Object.keys(parsed.filters).length > 0
  );
}

/**
 * Sync the pattern view with the URL. Call from `PatternsContainer` with the
 * store state and setters from `useChartPatterns`.
 */
export function usePatternUrlSync({
  universe,
  timeframe,
  filters,
  setUniverse,
  setTimeframe,
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
        const filtersOk = Object.entries(parsed.filters).every(([key, value]) => {
          const current = (filters as Record<string, unknown>)[key];
          if (Array.isArray(value)) {
            return Array.isArray(current) && current.join("|") === value.join("|");
          }
          return current === value;
        });
        if (!(universeOk && timeframeOk && filtersOk)) return; // wait for adoption
        hydratedRef.current = true;
      }
    }

    const next = buildPatternParams({ universe, timeframe, filters });
    // Preserve unrelated params (e.g. the screener's `?screener=`) untouched.
    for (const [key, value] of searchParams.entries()) {
      if (!PATTERN_PARAM_KEYS.has(key)) next.append(key, value);
    }
    const nextString = next.toString();
    if (nextString === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
    // Intentionally keyed on the synced state; `searchParams`/`setSearchParams`
    // are read imperatively and would re-trigger on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [universe, timeframe, filters]);
}
