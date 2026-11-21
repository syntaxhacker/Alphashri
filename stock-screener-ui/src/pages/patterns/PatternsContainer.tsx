import { createEffect, createSignal, onMount, onCleanup } from "solid-js";
import { useLocation, useSearchParams } from "@solidjs/router";
import {
  subscribe,
  getChartPatternsState,
  loadCatalog,
  triggerReplayScan,
  selectTimeframe,
  selectTimeframes,
  selectUniverse,
  selectSymbols,
  setFilter,
  setLookbackBars,
  resetFilters,
  applyFilters,
  triggerScan,
  refresh,
  forceRefresh,
  setComputeTrendlines,
  DEFAULT_TIMEFRAME,
  CUSTOM_UNIVERSE,
  DEFAULT_PATTERN_FILTERS,
} from "@/state/chartPatterns";
import {
  parsePatternParams,
  filterValuesEqual,
  type ParsedPatternParams,
} from "@/hooks/usePatternUrlSync";
import { PatternsPage } from "./PatternsPage";
import type { ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import type { IndexGroup } from "@/config/indexGroups";

/** Query keys the URL sync owns; everything else is left untouched on write. */
const PATTERN_PARAM_KEYS = [
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
] as const;

/**
 * Serialize state into a plain param object for @solidjs/router's
 * setSearchParams: a key set to null/""/an empty array is deleted from the URL
 * (see its mergeSearchString).
 */
function buildParamsObject(
  state: {
    universe: string;
    timeframe: string;
    selectedTimeframes?: string[];
    lookbackBars: number | null;
    computeTrendlines?: boolean;
    tab?: "scan" | "watch";
    view?: "matrix" | "list" | "grid";
    indexGroup?: IndexGroup;
    members?: string | null;
    filters: import("@/types/chartPatterns").PatternFilters;
  },
): Record<string, string | string[] | null> {
  const { filters } = state;
  const next: Record<string, string | string[] | null> = {};
  next.universe = state.universe ? state.universe : null;
  next.view = state.view && state.view !== "matrix" ? state.view : null;
  next.igroup = state.indexGroup && state.indexGroup !== "all" ? state.indexGroup : null;
  next.members = state.members ?? null;
  const selected = state.selectedTimeframes ?? [state.timeframe];
  if (selected.length > 1) {
    next.tf = selected.join(",");
  } else if (state.timeframe && state.timeframe !== DEFAULT_TIMEFRAME) {
    next.tf = state.timeframe;
  } else {
    next.tf = null;
  }
  next.lookback = state.lookbackBars != null ? String(state.lookbackBars) : null;

  next.pattern = (filters.pattern_id?.length ?? 0) > 0 ? [...filters.pattern_id!] : null;
  next.family = (filters.family?.length ?? 0) > 0 ? [...filters.family!] : null;
  next.direction = (filters.direction?.length ?? 0) > 0 ? [...filters.direction!] : null;
  next.status = (filters.status?.length ?? 0) > 0 ? [...filters.status!] : null;

  next.quality = filters.quality || null;
  next.within = filters.formed_within_bars != null ? String(filters.formed_within_bars) : null;
  next.volume_confirmed =
    filters.volume_confirmed != null ? String(filters.volume_confirmed) : null;
  next.min_rr = filters.min_rr != null ? String(filters.min_rr) : null;
  next.base = filters.min_base_days != null ? String(filters.min_base_days) : null;
  next.range = filters.max_range_pct != null ? String(filters.max_range_pct) : null;
  next.gap52 = filters.max_52w_gap != null ? String(filters.max_52w_gap) : null;
  next.pos = filters.min_range_pos != null ? String(filters.min_range_pos) : null;
  next.score = filters.min_confidence != null ? String(filters.min_confidence) : null;
  next.breakout = filters.min_breakout_score != null ? String(filters.min_breakout_score) : null;
  next.relvol = filters.min_rel_volume != null ? String(filters.min_rel_volume) : null;
  next.volm = filters.min_volume_m != null ? String(filters.min_volume_m) : null;
  next.avgvol = filters.min_avg_volume_10d != null ? String(filters.min_avg_volume_10d) : null;
  next.from = filters.from_date ? filters.from_date : null;
  next.to = filters.to_date ? filters.to_date : null;
  next.sort = filters.sort && filters.sort !== DEFAULT_PATTERN_FILTERS.sort ? filters.sort : null;
  next.hist =
    filters.history != null && filters.history !== DEFAULT_PATTERN_FILTERS.history
      ? String(filters.history)
      : null;
  next.q = filters.q || null;
  next.trendlines =
    filters.trendlines && filters.trendlines !== DEFAULT_PATTERN_FILTERS.trendlines
      ? filters.trendlines
      : null;
  next.compute_trendlines = state.computeTrendlines === false ? "0" : null;
  next.tab = state.tab === "watch" ? "watch" : null;
  if ((filters.symbols?.length ?? 0) > 0) {
    next.symbol = [...filters.symbols!];
  } else {
    next.symbol = filters.symbol || null;
  }
  return next;
}

/** Merge the owned keys over the existing query string (untouched otherwise). */
function mergeWithSearch(
  search: string,
  owned: Record<string, string | string[] | null>,
): string {
  const merged = new URLSearchParams(search);
  for (const key of PATTERN_PARAM_KEYS) {
    const value = owned[key];
    if (value == null || (Array.isArray(value) && value.length === 0)) {
      merged.delete(key);
    } else if (Array.isArray(value)) {
      merged.delete(key);
      for (const v of value) merged.append(key, v);
    } else {
      merged.set(key, value);
    }
  }
  const s = merged.toString();
  return s ? `?${s}` : "";
}

function normalizeSearch(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

export function PatternsContainer() {
  // ---- Store subscription (single source of truth) ---------------------
  const [snapshot, setSnapshot] = createSignal(getChartPatternsState());
  onMount(() => {
    const unsub = subscribe(() => setSnapshot(getChartPatternsState()));
    onCleanup(unsub);
  });

  const universe = () => snapshot().universe;
  const timeframe = () => snapshot().timeframe;
  const selectedTimeframes = () => snapshot().selectedTimeframes;
  const lookbackBars = () => snapshot().lookbackBars;
  const computeTrendlines = () => snapshot().computeTrendlines;
  const filters = () => snapshot().filters;
  const timeframes = () => snapshot().timeframes;
  const universes = () => snapshot().universes;
  const patterns = () => snapshot().patterns;
  const job = () => snapshot().job;
  const scanning = () => snapshot().scanning;
  const queuePosition = () => snapshot().queuePosition;
  const summary = () => snapshot().summary;
  const results = () => snapshot().results;
  const total = () => snapshot().total;
  const streaming = () => snapshot().streaming;
  const loading = () => snapshot().loading;
  const error = () => snapshot().error;

  // ---- Workspace tab (controlled for URL sync) ------------------------
  const [tab, setTab] = createSignal<"scan" | "watch">("scan");
  const [view, setView] = createSignal<"matrix" | "list" | "grid">("matrix");
  const [indexGroup, setIndexGroup] = createSignal<IndexGroup>("all");
  const [members, setMembers] = createSignal<string | null>(null);

  const [, setSearchParams] = useSearchParams();
  const location = useLocation();

  // ---- URL sync: parse once on mount, push on change, adopt back/forward -
  let hydrated = false;
  let firstRun = true;
  let parsed: ParsedPatternParams | null = null;
  let lastWritten = "";

  const currentState = () => ({
    universe: universe(),
    timeframe: timeframe(),
    selectedTimeframes: selectedTimeframes(),
    lookbackBars: lookbackBars(),
    computeTrendlines: computeTrendlines(),
    tab: tab(),
    view: view(),
    indexGroup: indexGroup(),
    members: members(),
    filters: filters(),
  });

  createEffect(() => {
    // Mount-only: parse the incoming URL and adopt it into the store.
    if (hydrated || parsed !== null) return;
    const raw = new URLSearchParams(location.search);
    const p = parsePatternParams(raw);
    const hasParams =
      p.universe != null ||
      p.timeframe != null ||
      p.lookback != null ||
      p.computeTrendlines != null ||
      p.tab != null ||
      p.view != null ||
      p.indexGroup != null ||
      p.members != null ||
      Object.keys(p.filters).length > 0;
    if (!hasParams) {
      hydrated = true;
      return;
    }
    parsed = p;
    if (p.universe && p.universe !== universe()) selectUniverse(p.universe);
    const currentSelection = selectedTimeframes() ?? [timeframe()];
    if (p.timeframes) {
      if (!filterValuesEqual(currentSelection, p.timeframes)) {
        selectTimeframes(p.timeframes);
      }
    } else if (p.timeframe && p.timeframe !== timeframe()) {
      selectTimeframe(p.timeframe);
    }
    if (p.lookback != null && p.lookback !== lookbackBars()) setLookbackBars(p.lookback);
    if (p.computeTrendlines != null && p.computeTrendlines !== computeTrendlines()) {
      setComputeTrendlines(p.computeTrendlines);
    }
    if (p.tab != null && p.tab !== tab()) setTab(p.tab);
    if (p.view != null && p.view !== view()) setView(p.view);
    if (p.indexGroup != null && p.indexGroup !== indexGroup()) setIndexGroup(p.indexGroup);
    if (p.members != null && p.members !== members()) setMembers(p.members);
    const filtersDiffer = Object.entries(p.filters).some(([key, value]) => {
      const current = (filters() as Record<string, unknown>)[key];
      return !filterValuesEqual(current, value);
    });
    if (filtersDiffer) applyFilters(p.filters);
  });

  createEffect(() => {
    // Skip the first commit (initial defaults).
    const state = currentState();
    if (firstRun) {
      firstRun = false;
      lastWritten = mergeWithSearch(location.search, buildParamsObject(state));
      return;
    }
    if (!hydrated && parsed) {
      const p = parsed;
      const universeOk = !p.universe || state.universe === p.universe;
      const timeframeOk = !p.timeframe || state.timeframe === p.timeframe;
      const timeframesOk =
        !p.timeframes ||
        filterValuesEqual(state.selectedTimeframes ?? [state.timeframe], p.timeframes);
      const lookbackOk = p.lookback == null || state.lookbackBars === p.lookback;
      const computeOk =
        p.computeTrendlines == null ||
        (state.computeTrendlines ?? true) === p.computeTrendlines;
      const tabOk = p.tab == null || (state.tab ?? "scan") === p.tab;
      const viewOk = p.view == null || (state.view ?? "matrix") === p.view;
      const indexGroupOk =
        p.indexGroup == null || (state.indexGroup ?? "all") === p.indexGroup;
      const membersOk = p.members == null || (state.members ?? null) === p.members;
      const filtersOk = Object.entries(p.filters).every(([key, value]) => {
        const current = (state.filters as Record<string, unknown>)[key];
        return filterValuesEqual(current, value);
      });
      if (
        !(
          universeOk && timeframeOk && timeframesOk && lookbackOk && computeOk && tabOk &&
          viewOk && indexGroupOk && membersOk && filtersOk
        )
      ) {
        return; // wait for the store to adopt the parsed URL
      }
      hydrated = true;
    } else if (!hydrated) {
      hydrated = true;
    }

    const next = buildParamsObject(state);
    const merged = mergeWithSearch(location.search, next);
    lastWritten = merged;
    if (normalizeSearch(location.search) === normalizeSearch(merged)) return;
    setSearchParams(next, { replace: true });
  });

  createEffect(() => {
    // Back/forward (or manual) navigation: adopt a URL that differs from
    // what this sync last wrote.
    const search = location.search;
    if (!hydrated) return;
    const merged = mergeWithSearch(search, buildParamsObject(currentState()));
    if (merged === lastWritten) return;
    if (!normalizeSearch(search)) return;
    lastWritten = merged;

    const p = parsePatternParams(new URLSearchParams(search));
    if (p.universe && p.universe !== universe()) selectUniverse(p.universe);
    if (p.timeframes) {
      if (!filterValuesEqual(selectedTimeframes() ?? [timeframe()], p.timeframes)) {
        selectTimeframes(p.timeframes);
      }
    } else if (p.timeframe && p.timeframe !== timeframe()) {
      selectTimeframe(p.timeframe);
    }
    if ((p.lookback ?? null) !== (lookbackBars() ?? null)) {
      setLookbackBars(p.lookback);
    }
    if (p.computeTrendlines != null && p.computeTrendlines !== (computeTrendlines() ?? true)) {
      setComputeTrendlines(p.computeTrendlines);
    }
    if (p.tab != null && p.tab !== tab()) setTab(p.tab);
    if (p.view != null && p.view !== view()) setView(p.view);
    if (p.indexGroup != null && p.indexGroup !== indexGroup()) setIndexGroup(p.indexGroup);
    if (p.members !== (members() ?? null)) setMembers(p.members);
    const entries = Object.entries(p.filters);
    if (entries.length > 0) {
      const differs = entries.some(([key, value]) => {
        const currentValue = (filters() as Record<string, unknown>)[key];
        return !filterValuesEqual(currentValue, value);
      });
      if (differs) applyFilters(p.filters);
    }
  });

  onMount(() => {
    void loadCatalog();
  });

  createEffect(() => {
    // Adopt a sane default when the store's timeframes arrive late.
    const list = timeframes();
    if (list.length === 0) return;
    if (list.some((tf) => tf.id === timeframe())) return;
    selectTimeframe(DEFAULT_TIMEFRAME);
  });

  return (
    <PatternsPage
      timeframes={timeframes()}
      universes={universes()}
      patterns={patterns()}
      timeframe={timeframe()}
      setTimeframe={selectTimeframe}
      selectedTimeframes={selectedTimeframes()}
      setSelectedTimeframes={selectTimeframes}
      lookbackBars={lookbackBars()}
      setLookbackBars={setLookbackBars}
      universe={universe()}
      setUniverse={selectUniverse}
      filters={filters()}
      setFilter={setFilter}
      resetFilters={resetFilters}
      applyFilters={applyFilters}
      computeTrendlines={computeTrendlines()}
      setComputeTrendlines={setComputeTrendlines}
      customUniverse={CUSTOM_UNIVERSE}
      selectSymbols={selectSymbols}
      job={job()}
      scanning={scanning()}
      queuePosition={queuePosition()}
      summary={summary()}
      results={results()}
      total={total()}
      streaming={streaming()}
      loading={loading()}
      error={error()}
      scan={() => void triggerScan()}
      refresh={refresh}
      forceRefresh={forceRefresh}
      scanReplay={(args: ReplayScanArgs) => {
        void triggerReplayScan(args.asOf, args.from);
      }}
      replayAsOf={snapshot().lastScanAsOf}
      tab={tab()}
      setTab={setTab}
      view={view()}
      setView={setView}
      indexGroup={indexGroup()}
      setIndexGroup={setIndexGroup}
      members={members()}
      setMembers={setMembers}
    />
  );
}

export default PatternsContainer;
