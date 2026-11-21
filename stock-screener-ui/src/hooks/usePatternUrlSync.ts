/**
 * `usePatternUrlSync` — keeps the `/patterns` view shareable by mirroring the
 * active universe, timeframe and filter rail into the URL query string.
 *
 * Short keys keep links compact:
 *   universe, tf, pattern (repeat), family (repeat), direction (repeat),
 *   status (repeat), quality, within, volume_confirmed, min_rr, base, range,
 *   gap52, pos, score, breakout, relvol, volm, avgvol, hist (patterns per
 *   symbol), from, to, sort, symbol (a lone `symbol=` is the singular symbol filter; repeated
 *   `symbol=` values are the multi-symbol filter), q, trendlines,
 *   compute_trendlines (`=0` only, when trendline computation is skipped).
 *   Compact comma-separated forms are also accepted on parse: `symbols=a,b`,
 *   `patterns=a,b`, `families=a,b`, `directions=a,b`, `statuses=a,b`.
 *
 * Reads the URL once on mount (so a bookmarked view is restored) and writes
 * non-default state back on change. After hydration it also adopts later URL
 * changes (back/forward navigation) that differ from what it last wrote. The
 * screener's `?screener=` param is left untouched — this hook only manages the
 * keys listed below.
 */

import { createEffect } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import type { PatternFilters, TrendlinesView } from "../types/chartPatterns";
import { DEFAULT_PATTERN_FILTERS, DEFAULT_TIMEFRAME } from "../state/chartPatterns";
import type { IndexGroup } from "../config/indexGroups";

/** Parsed URL: active selection plus a partial filter patch (defaults omitted). */
export interface ParsedPatternParams {
  universe: string | null;
  timeframe: string | null;
  timeframes: string[] | null;
  lookback: number | null;
  /** False when `compute_trendlines=0`; true when `=1`; null when omitted. */
  computeTrendlines: boolean | null;
  /** Active workspace tab (`scan`|`watch`); null when omitted (defaults to scan). */
  tab: "scan" | "watch" | null;
  /** Results view (`matrix`|`list`|`grid`); null when omitted (defaults to matrix). */
  view: "matrix" | "list" | "grid" | null;
  /** Index group filter (`all`|`big`|`others`); null when omitted (defaults to all). */
  indexGroup: IndexGroup | null;
  /** Open index-members drawer for this index id (null = closed). */
  members: string | null;
  filters: Partial<PatternFilters>;
}

/** State slice the hook serializes back into the URL. */
export interface PatternUrlState {
  universe: string;
  timeframe: string;
  selectedTimeframes?: string[];
  lookbackBars: number | null;
  /** Omitted (compute) is the default; only `false` is written. */
  computeTrendlines?: boolean;
  /** Active workspace tab; only `watch` is written (`scan` is the default). */
  tab?: "scan" | "watch";
  /** Results view; `list`/`grid` are written (`matrix` is the default). */
  view?: "matrix" | "list" | "grid";
  /** Index group; `big`/`others` are written (`all` is the default). */
  indexGroup?: IndexGroup;
  /** Open index-members drawer for this index id. */
  members?: string | null;
  filters: PatternFilters;
}

/**
 * A value the hook can read either as a plain snapshot or as an accessor.
 *
 * Solid components run once, so a hook that destructures plain props can never
 * observe a later state change. Call sites pass their store state as accessors
 * (`() => store.universe`) so the effects below track it; plain values keep
 * working for one-shot use and for `renderSolidHookReactive` harnesses.
 */
export type UrlSyncSource<T> = T | (() => T);

/** Read a `UrlSyncSource` inside a reactive context (this is what tracks it). */
function readSource<T>(source: UrlSyncSource<T>): T {
  return typeof source === "function" ? (source as () => T)() : source;
}

/** Read an optional `UrlSyncSource`, preserving `undefined`. */
function readOptional<T>(source: UrlSyncSource<T | undefined> | undefined): T | undefined {
  return source === undefined ? undefined : readSource<T | undefined>(source);
}

export interface UsePatternUrlSyncArgs {
  universe: UrlSyncSource<string>;
  timeframe: UrlSyncSource<string>;
  selectedTimeframes?: UrlSyncSource<string[] | undefined>;
  lookbackBars: UrlSyncSource<number | null>;
  /** Omitted (compute) is the default; only `false` is written. */
  computeTrendlines?: UrlSyncSource<boolean | undefined>;
  /** Active workspace tab; only `watch` is written (`scan` is the default). */
  tab?: UrlSyncSource<"scan" | "watch" | undefined>;
  /** Results view; `list`/`grid` are written (`matrix` is the default). */
  view?: UrlSyncSource<"matrix" | "list" | "grid" | undefined>;
  /** Index group; `big`/`others` are written (`all` is the default). */
  indexGroup?: UrlSyncSource<IndexGroup | undefined>;
  /** Open index-members drawer for this index id. */
  members?: UrlSyncSource<string | null | undefined>;
  filters: UrlSyncSource<PatternFilters>;
  setUniverse: (universe: string) => void;
  setTimeframe: (timeframe: string) => void;
  setSelectedTimeframes?: (timeframes: string[]) => void;
  setLookbackBars: (bars: number | null) => void;
  /** Optional so existing call sites keep compiling; the container provides it. */
  setComputeTrendlines?: (value: boolean) => void;
  /** Optional; when provided the `tab` param round-trips through the URL. */
  setTab?: (tab: "scan" | "watch") => void;
  /** Optional; when provided the `view` param round-trips through the URL. */
  setView?: (view: "matrix" | "list" | "grid") => void;
  /** Optional; when provided the `igroup` param round-trips through the URL. */
  setIndexGroup?: (group: IndexGroup) => void;
  /** Optional; when provided the `members` param round-trips through the URL. */
  setMembers?: (indexId: string | null) => void;
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
/**
 * Multi-value query param with a compact comma-separated plural form.
 * `key` may repeat (`pattern=a&pattern=b`); `plural` holds `a,b`.
 * Returns deduped values preserving order. Values are upper-cased for
 * symbols, left as-is otherwise.
 */
function multiParam(params: URLSearchParams, key: string, plural: string, upper = false): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const val = upper ? v.trim().toUpperCase() : v.trim();
    if (val !== "" && !out.includes(val)) out.push(val);
  };
  for (const v of params.getAll(key)) push(v);
  for (const v of (params.get(plural) ?? "").split(",")) push(v);
  return out;
}

export function parsePatternParams(params: URLSearchParams): ParsedPatternParams {
  const filters: Partial<PatternFilters> = {};
  // The custom scope is addressed by `universe=custom`; its constituent list
  // must hydrate `filters.symbols` even when the URL carries a single
  // `symbol=` (the compact serialization writes one key for one symbol).
  const universeParam = params.get("universe") || null;

  const pattern = multiParam(params, "pattern", "patterns");
  if (pattern.length > 0) filters.pattern_id = pattern;
  const family = multiParam(params, "family", "families");
  if (family.length > 0) filters.family = family;
  const direction = multiParam(params, "direction", "directions");
  if (direction.length > 0) filters.direction = direction;
  const status = multiParam(params, "status", "statuses");
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
  const minConfidence = numberOrNull(params.get("score"));
  if (minConfidence != null) filters.min_confidence = minConfidence;
  const minBreakoutScore = numberOrNull(params.get("breakout"));
  if (minBreakoutScore != null) filters.min_breakout_score = minBreakoutScore;
  const minRelVolume = numberOrNull(params.get("relvol"));
  if (minRelVolume != null) filters.min_rel_volume = minRelVolume;
  const minVolumeM = numberOrNull(params.get("volm"));
  if (minVolumeM != null) filters.min_volume_m = minVolumeM;
  const minAvgVolume10d = numberOrNull(params.get("avgvol"));
  if (minAvgVolume10d != null) filters.min_avg_volume_10d = minAvgVolume10d;

  // Patterns-per-symbol view depth (1/3/5). Non-positive values mean "unset".
  const history = numberOrNull(params.get("hist"));
  if (history != null && history > 0) filters.history = Math.trunc(history);

  const from = params.get("from");
  if (from) filters.from_date = from;
  const to = params.get("to");
  if (to) filters.to_date = to;

  const sort = params.get("sort");
  if (sort) filters.sort = sort;

  // One `symbol=` is the singular symbol filter; several are the multi-symbol
  // filter (mirrors how the API layer serializes them onto one key).
  // A compact `symbols=a,b,c` form is also accepted (hand-typed URLs).
  const symbols = multiParam(params, "symbol", "symbols", true);
  if (symbols.length > 1) filters.symbols = symbols;
  else if (symbols.length === 1) {
    if (universeParam === "custom") filters.symbols = symbols;
    else filters.symbol = symbols[0];
  }

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

  const timeframes: string[] = [];
  for (const raw of params.getAll("tf")) {
    for (const part of raw.split(",")) {
      const value = part.trim();
      if (value && !timeframes.includes(value)) timeframes.push(value);
    }
  }

  const rawView = params.get("view");
  const view: "matrix" | "list" | "grid" | null =
    rawView === "list" || rawView === "grid" || rawView === "matrix" ? rawView : null;
  const rawGroup = params.get("igroup");
  const indexGroup: IndexGroup | null =
    rawGroup === "all" || rawGroup === "big" || rawGroup === "others" ? rawGroup : null;
  const rawMembers = params.get("members");
  const members = rawMembers ? rawMembers.trim().toUpperCase() : null;

  return {
    universe: universeParam,
    timeframe: timeframes.length > 0 ? timeframes[0] : null,
    timeframes: timeframes.length > 0 ? timeframes : null,
    view,
    indexGroup,
    members,
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
  if (state.view && state.view !== "matrix") params.set("view", state.view);
  if (state.indexGroup && state.indexGroup !== "all") params.set("igroup", state.indexGroup);
  if (state.members) params.set("members", state.members);
  const selected = state.selectedTimeframes ?? [state.timeframe];
  if (selected.length > 1) {
    params.set("tf", selected.join(","));
  } else if (state.timeframe && state.timeframe !== DEFAULT_TIMEFRAME) {
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
  if (filters.min_confidence != null) params.set("score", String(filters.min_confidence));
  if (filters.min_breakout_score != null) params.set("breakout", String(filters.min_breakout_score));
  if (filters.min_rel_volume != null) params.set("relvol", String(filters.min_rel_volume));
  if (filters.min_volume_m != null) params.set("volm", String(filters.min_volume_m));
  if (filters.min_avg_volume_10d != null) params.set("avgvol", String(filters.min_avg_volume_10d));
  if (filters.from_date) params.set("from", filters.from_date);
  if (filters.to_date) params.set("to", filters.to_date);
  if (filters.sort && filters.sort !== DEFAULT_PATTERN_FILTERS.sort) {
    params.set("sort", filters.sort);
  }
  if (filters.history != null && filters.history !== DEFAULT_PATTERN_FILTERS.history) {
    params.set("hist", String(filters.history));
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
  "score",
  "breakout",
  "relvol",
  "volm",
  "avgvol",
  "hist",
  "from",
  "to",
  "sort",
  "symbol",
  "q",
  "trendlines",
  "compute_trendlines",
  "tab",
  "view",
  "igroup",
  "members",
]);

/** True when a parsed URL actually carries any pattern param. */
function hasAnyPatternParam(parsed: ParsedPatternParams): boolean {
  return (
    parsed.universe != null ||
    parsed.timeframe != null ||
    parsed.lookback != null ||
    parsed.computeTrendlines != null ||
    parsed.tab != null ||
    parsed.view != null ||
    parsed.indexGroup != null ||
    parsed.members != null ||
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
  selectedTimeframes,
  lookbackBars,
  computeTrendlines,
  tab,
  view,
  indexGroup,
  members,
  filters,
  setUniverse,
  setTimeframe,
  setSelectedTimeframes,
  setLookbackBars,
  setComputeTrendlines,
  setTab,
  setView,
  setIndexGroup,
  setMembers,
  applyFilters,
}: UsePatternUrlSyncArgs): void {
  const [searchParams, setSearchParams] = useSearchParams();
  // Plain flags, not refs: Solid needs no mutable box for non-reactive state,
  // and `.current` does not exist here.
  let didRead = false;
  // Parsed selection from the initial URL (null when the URL carried none).
  let parsedParams: ParsedPatternParams | null = null;
  // Becomes true once the store has adopted the parsed selection, so the first
  // write reflects the applied state instead of clobbering the incoming params.
  let hydrated = false;
  // Skip the very first write commit (initial defaults) — only real changes write.
  let firstRun = true;
  // Serialized URL this hook last wrote (or last observed). A `searchParams`
  // change to anything else is external navigation (back/forward, manual edit)
  // and must be adopted rather than clobbered.
  let lastWritten: string | null = null;

  createEffect(() => {
    if (didRead) return;
    didRead = true;

    const parsed = parsePatternParams(searchParams);
    if (!hasAnyPatternParam(parsed)) {
      hydrated = true;
      return;
    }

    parsedParams = parsed;
    if (parsed.universe && parsed.universe !== readSource(universe)) setUniverse(parsed.universe);
    const currentSelection = readOptional(selectedTimeframes) ?? [readSource(timeframe)];
    if (parsed.timeframes) {
      if (!filterValuesEqual(currentSelection, parsed.timeframes)) {
        if (setSelectedTimeframes) setSelectedTimeframes(parsed.timeframes);
        else setTimeframe(parsed.timeframes[0]);
      }
    } else if (parsed.timeframe && parsed.timeframe !== readSource(timeframe)) {
      setTimeframe(parsed.timeframe);
    }
    if (parsed.lookback != null && parsed.lookback !== readSource(lookbackBars)) {
      setLookbackBars(parsed.lookback);
    }
    if (
      parsed.computeTrendlines != null &&
      parsed.computeTrendlines !== readOptional(computeTrendlines)
    ) {
      setComputeTrendlines?.(parsed.computeTrendlines);
    }
    if (parsed.tab != null && parsed.tab !== readOptional(tab)) setTab?.(parsed.tab);
    if (parsed.view != null && parsed.view !== readOptional(view)) setView?.(parsed.view);
    if (parsed.indexGroup != null && parsed.indexGroup !== readOptional(indexGroup)) {
      setIndexGroup?.(parsed.indexGroup);
    }
    if (parsed.members != null && parsed.members !== readOptional(members)) {
      setMembers?.(parsed.members);
    }
    const currentFilters = readSource(filters) as Record<string, unknown>;
    const filtersDiffer = Object.entries(parsed.filters).some(([key, value]) => {
      return !filterValuesEqual(currentFilters[key], value);
    });
    if (filtersDiffer) applyFilters(parsed.filters);
    // Intentionally mount-only: read the URL once, then let changes write back.
  });

  createEffect(() => {
    // Read every source up front: a Solid effect only re-runs for what it
    // actually read, and the first commit below returns early.
    const universeValue = readSource(universe);
    const timeframeValue = readSource(timeframe);
    const selected = readOptional(selectedTimeframes);
    const lookback = readSource(lookbackBars);
    const compute = readOptional(computeTrendlines);
    const tabValue = readOptional(tab);
    const viewValue = readOptional(view);
    const indexGroupValue = readOptional(indexGroup);
    const membersValue = readOptional(members);
    const filtersValue = readSource(filters);

    if (firstRun) {
      firstRun = false;
      // Seed the "last known URL" with what we just read, so the pending-change
      // guard below does not trip on the initial commit.
      lastWritten = searchParams.toString();
      return;
    }
    // An external navigation (back/forward, manual edit) is pending adoption in
    // the effect below: writing now would clobber the incoming URL.
    if (searchParams.toString() !== lastWritten) return;
    if (!hydrated) {
      const parsed = parsedParams;
      if (!parsed) {
        hydrated = true;
      } else {
        const universeOk = !parsed.universe || universeValue === parsed.universe;
        const timeframeOk = !parsed.timeframe || timeframeValue === parsed.timeframe;
        const timeframesOk =
          !parsed.timeframes ||
          filterValuesEqual(selected ?? [timeframeValue], parsed.timeframes);
        const lookbackOk = parsed.lookback == null || lookback === parsed.lookback;
        const computeOk =
          parsed.computeTrendlines == null ||
          (compute ?? true) === parsed.computeTrendlines;
        const tabOk = parsed.tab == null || (tabValue ?? "scan") === parsed.tab;
        const viewOk = parsed.view == null || (viewValue ?? "matrix") === parsed.view;
        const indexGroupOk =
          parsed.indexGroup == null || (indexGroupValue ?? "all") === parsed.indexGroup;
        const membersOk = parsed.members == null || (membersValue ?? null) === parsed.members;
        const filtersOk = Object.entries(parsed.filters).every(([key, value]) => {
          const current = (filtersValue as Record<string, unknown>)[key];
          return filterValuesEqual(current, value);
        });
        if (!(universeOk && timeframeOk && timeframesOk && lookbackOk && computeOk && tabOk && viewOk && indexGroupOk && membersOk && filtersOk)) return; // wait for adoption
        hydrated = true;
      }
    }

    const next = buildPatternParams({
      universe: universeValue,
      timeframe: timeframeValue,
      selectedTimeframes: selected ?? [timeframeValue],
      lookbackBars: lookback,
      computeTrendlines: compute,
      tab: tabValue,
      view: viewValue,
      indexGroup: indexGroupValue,
      members: membersValue,
      filters: filtersValue,
    });
    // Preserve unrelated params (e.g. the screener's `?screener=`) untouched.
    for (const [key, value] of searchParams.entries()) {
      if (!PATTERN_PARAM_KEYS.has(key)) next.append(key, value);
    }
    const nextString = next.toString();
    lastWritten = nextString;
    if (nextString === searchParams.toString()) return;
    setSearchParams(next, { replace: true });
    // Intentionally keyed on the synced state; `searchParams`/`setSearchParams`
    // are read imperatively and would re-trigger on every navigation.
  });

  // Back/forward (or manual) navigation: once hydrated, adopt a URL that
  // differs from what this hook last wrote. Setter calls are diffed against
  // current state so adopting an equivalent URL is a no-op, and the write
  // effect above converges instead of looping (`next === searchParams`).
  createEffect(() => {
    // Read first so the effect subscribes even before it is hydrated.
    const universeValue = readSource(universe);
    const timeframeValue = readSource(timeframe);
    const selected = readOptional(selectedTimeframes);
    const lookback = readSource(lookbackBars);
    const compute = readOptional(computeTrendlines);
    const tabValue = readOptional(tab);
    const viewValue = readOptional(view);
    const indexGroupValue = readOptional(indexGroup);
    const membersValue = readOptional(members);
    const filtersValue = readSource(filters) as Record<string, unknown>;

    if (!hydrated) return;
    const currentSearch = searchParams.toString();
    if (currentSearch === lastWritten) return;
    lastWritten = currentSearch;
    const parsed = parsePatternParams(searchParams);
    if (parsed.universe && parsed.universe !== universeValue) setUniverse(parsed.universe);
    if (parsed.timeframes) {
      if (!filterValuesEqual(selected ?? [timeframeValue], parsed.timeframes)) {
        if (setSelectedTimeframes) setSelectedTimeframes(parsed.timeframes);
        else if (parsed.timeframes[0] !== timeframeValue) setTimeframe(parsed.timeframes[0]);
      }
    } else if (parsed.timeframe && parsed.timeframe !== timeframeValue) {
      setTimeframe(parsed.timeframe);
    }
    if ((parsed.lookback ?? null) !== (lookback ?? null)) {
      setLookbackBars(parsed.lookback);
    }
    if (parsed.computeTrendlines != null && parsed.computeTrendlines !== (compute ?? true)) {
      setComputeTrendlines?.(parsed.computeTrendlines);
    }
    if (parsed.tab != null && parsed.tab !== (tabValue ?? "scan")) {
      setTab?.(parsed.tab);
    }
    if (parsed.view != null && parsed.view !== (viewValue ?? "matrix")) {
      setView?.(parsed.view);
    }
    if (parsed.indexGroup != null && parsed.indexGroup !== (indexGroupValue ?? "all")) {
      setIndexGroup?.(parsed.indexGroup);
    }
    if (parsed.members !== (membersValue ?? null)) {
      setMembers?.(parsed.members);
    }
    const entries = Object.entries(parsed.filters);
    if (entries.length > 0) {
      const differs = entries.some(([key, value]) => {
        return !filterValuesEqual(filtersValue[key], value);
      });
      if (differs) applyFilters(parsed.filters);
    }
    // Intentionally keyed on the URL; state/setters are read imperatively.
  });
}
