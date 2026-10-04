/**
 * Chart Patterns state (net-new).
 *
 * Follows the app's `createSubscriber` pub/sub pattern (no Redux, no `useState`
 * for store data). All async loaders live here; the hook just subscribes.
 */

import { createSubscriber } from "./createSubscriber";
import type {
  TFSpec,
  Universe,
  PatternDef,
  PatternFamily,
  JobDTO,
  JobStatus,
  PatternHitDTO,
  PatternSummary,
  SymbolDetail,
  ChartPayload,
  PatternFilters,
  PatternsQuery,
} from "../types/chartPatterns";
import {
  QueueFullError,
  fetchTimeframes,
  fetchUniverses,
  fetchPatternCatalog,
  startScan,
  fetchJob,
  fetchActiveJobs,
  fetchResults,
  fetchSummary,
  fetchSymbolDetail,
  fetchSymbolChart,
} from "../api/chartPatterns";

/** Poll cadence while a scan job is queued/running. */
export const POLL_INTERVAL_MS = 2000;
export const DEFAULT_TIMEFRAME = "1D";
/** Reserved universe id for a hand-picked symbol scan (no preset universe). */
export const CUSTOM_UNIVERSE = "custom";
export const DEFAULT_RESULTS_LIMIT = 200;
/**
 * A combo whose last completed scan is older than this (or that has never been
 * scanned) is considered stale and gets an automatic background refresh, even
 * when it currently has hits. Keeps stored payloads (trendlines/pivots) fresh.
 */
export const STALE_SCAN_MINUTES = 30;

export const DEFAULT_PATTERN_FILTERS: PatternFilters = {
  family: [],
  pattern_id: [],
  direction: [],
  status: [],
  quality: null,
  formed_within_bars: null,
  volume_confirmed: null,
  min_rr: null,
  symbol: null,
  symbols: [],
  q: "",
  min_base_days: null,
  max_range_pct: null,
  sort: "confidence",
  trendlines: "both",
};

export interface ChartPatternsState {
  timeframes: TFSpec[];
  universes: Universe[];
  defaultUniverse: string;
  patterns: PatternDef[];
  families: PatternFamily[];
  timeframe: string;
  universe: string;
  /** Lookback window in bars (null = Auto / server default). */
  lookbackBars: number | null;
  filters: PatternFilters;
  job: JobDTO | null;
  scanning: boolean;
  summary: PatternSummary | null;
  results: PatternHitDTO[];
  total: number;
  dataThrough: string | null;
  selectedSymbol: string | null;
  detail: SymbolDetail | null;
  detailChart: ChartPayload | null;
  loading: boolean;
  error: string | null;
}

function createInitialState(): ChartPatternsState {
  return {
    timeframes: [],
    universes: [],
    defaultUniverse: "",
    patterns: [],
    families: [],
    timeframe: DEFAULT_TIMEFRAME,
    universe: "",
    lookbackBars: null,
    filters: { ...DEFAULT_PATTERN_FILTERS },
    job: null,
    scanning: false,
    summary: null,
    results: [],
    total: 0,
    dataThrough: null,
    selectedSymbol: null,
    detail: null,
    detailChart: null,
    loading: false,
    error: null,
  };
}

let state: ChartPatternsState = createInitialState();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollToken = 0;
let inflight = 0;

/**
 * Monotonic generations for the two background loaders. A response (or failure)
 * whose generation is no longer the latest is stale and must not touch state —
 * otherwise a slow earlier request overwrites fresher data (or a slow failure
 * surfaces an error for a view that already recovered).
 */
let resultsGeneration = 0;
let summaryGeneration = 0;

/**
 * `universe|timeframe` combinations we have already auto-requested a scan for
 * this session. Prevents repeatedly resubmitting a scan while an empty result
 * set is being viewed for a combo that genuinely has no hits yet.
 */
const autoScanRequested = new Set<string>();

const { subscribe, notify } = createSubscriber();
export { subscribe };

export function getChartPatternsState(): ChartPatternsState {
  return state;
}

function patch(partial: Partial<ChartPatternsState>): void {
  state = { ...state, ...partial };
  notify();
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function startLoading(): void {
  inflight += 1;
  // NOTE: never clear `error` here — this runs on every concurrent loader start
  // and would erase a real failure recorded by an overlapping loader. Actions
  // clear `error` explicitly at their own start (and on success) instead.
  patch({ loading: true });
}

function finishLoading(): void {
  inflight = Math.max(0, inflight - 1);
  if (inflight === 0) patch({ loading: false });
}

function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

// ---------------------------------------------------------------------------
// Setters
// ---------------------------------------------------------------------------

export function setTimeframes(timeframes: TFSpec[]): void {
  patch({ timeframes });
}

export function setUniverses(universes: Universe[]): void {
  patch({ universes });
}

export function setPatterns(patterns: PatternDef[], families: PatternFamily[]): void {
  patch({ patterns, families });
}

export function setTimeframe(timeframe: string): void {
  patch({ timeframe });
}

export function setUniverse(universe: string): void {
  patch({ universe });
}

/** Set the lookback window (null = Auto) and force a re-scan of the scope. */
export function setLookbackBars(bars: number | null): void {
  if (bars === state.lookbackBars) return;
  const { universe, timeframe } = state;
  patch({ lookbackBars: bars, error: null });
  void loadResults({ offset: 0 });
  void loadSummary();
  void triggerScan(true, { universe, timeframe });
}

export function setFilters(filters: PatternFilters): void {
  patch({ filters });
}

/** Set one filter-rail value and reload the visible results/summary. */
export function setFilter<K extends keyof PatternFilters>(
  key: K,
  value: PatternFilters[K],
): void {
  patch({ filters: { ...state.filters, [key]: value }, error: null });
  void loadResults({ offset: 0 });
  void loadSummary();
}

/** Clear all filters back to defaults and reload results/summary. */
export function resetFilters(): void {
  patch({ filters: { ...DEFAULT_PATTERN_FILTERS }, error: null });
  void loadResults({ offset: 0 });
  void loadSummary();
}

/**
 * Apply a partial filter patch, merged onto `DEFAULT_PATTERN_FILTERS` (so
 * unspecified keys reset), then reload results/summary. Used by presets.
 */
export function applyFilters(filters: Partial<PatternFilters>): void {
  patch({ filters: { ...DEFAULT_PATTERN_FILTERS, ...filters }, error: null });
  void loadResults({ offset: 0 });
  void loadSummary();
}

export function setJob(job: JobDTO | null): void {
  patch({ job });
}

export function setSummary(summary: PatternSummary | null): void {
  patch({ summary });
}

export function setResults(results: PatternHitDTO[], total: number): void {
  patch({ results, total });
}

export function setScanning(scanning: boolean): void {
  patch({ scanning });
}

export function setError(error: string | null): void {
  patch({ error });
}

export function setSelectedSymbol(selectedSymbol: string | null): void {
  if (!selectedSymbol) {
    patch({ selectedSymbol: null, detail: null, detailChart: null });
    return;
  }
  void loadSymbolDetail(selectedSymbol);
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

function baseQuery(): PatternsQuery {
  const custom = state.universe === CUSTOM_UNIVERSE;
  return {
    // A custom scope is defined by its symbols, not a universe: query by symbol
    // so known patterns for those symbols show regardless of which scan made them.
    universe: custom ? null : state.universe || null,
    timeframe: state.timeframe || null,
    family: state.filters.family,
    pattern_id: state.filters.pattern_id,
    direction: state.filters.direction,
    status: state.filters.status,
    quality: state.filters.quality,
    formed_within_bars: state.filters.formed_within_bars,
    volume_confirmed: state.filters.volume_confirmed,
    min_rr: state.filters.min_rr,
    symbol: state.filters.symbol,
    symbols: state.filters.symbols,
    q: state.filters.q,
    min_base_days: state.filters.min_base_days,
    max_range_pct: state.filters.max_range_pct,
    sort: state.filters.sort,
  };
}

// ---------------------------------------------------------------------------
// Async loaders
// ---------------------------------------------------------------------------

/** Load timeframe registry, universes and pattern catalog, then initial data. */
export async function loadCatalog(): Promise<void> {
  patch({ error: null });
  startLoading();
  try {
    const [timeframes, universes, catalog] = await Promise.all([
      fetchTimeframes(),
      fetchUniverses(),
      fetchPatternCatalog(),
    ]);
    patch({
      timeframes,
      universes: universes.universes,
      defaultUniverse: universes.default || state.defaultUniverse,
      universe: state.universe || universes.default,
      patterns: catalog.patterns,
      families: catalog.families,
      error: null,
    });
  } catch (error) {
    patch({ error: toMessage(error, "Failed to load chart-pattern catalog") });
  } finally {
    finishLoading();
  }

  await Promise.all([loadSummary(), loadResults({ offset: 0 }), loadActiveJobs()]);
  maybeAutoScan();
}

/** Load the current result page for the active universe/timeframe/filters. */
export async function loadResults(overrides: Partial<PatternsQuery> = {}): Promise<void> {
  // Custom scope with no symbols has nothing to show — and must never fall back
  // to an unscoped query, which would return every universe's hits.
  if (state.universe === CUSTOM_UNIVERSE && state.filters.symbols.length === 0) {
    patch({ results: [], total: 0 });
    return;
  }
  const generation = ++resultsGeneration;
  startLoading();
  try {
    const data = await fetchResults({
      ...baseQuery(),
      limit: DEFAULT_RESULTS_LIMIT,
      offset: 0,
      ...overrides,
    });
    if (generation !== resultsGeneration) return;
    patch({ results: data.items, total: data.total, dataThrough: data.data_through ?? null });
  } catch (error) {
    if (generation !== resultsGeneration) return;
    patch({ error: toMessage(error, "Failed to load pattern results") });
  } finally {
    finishLoading();
  }
}

/** Load the aggregate summary for the active universe/timeframe/filters. */
export async function loadSummary(overrides: Partial<PatternsQuery> = {}): Promise<void> {
  if (state.universe === CUSTOM_UNIVERSE && state.filters.symbols.length === 0) {
    patch({ summary: null, dataThrough: null });
    return;
  }
  const generation = ++summaryGeneration;
  startLoading();
  try {
    const summary = await fetchSummary({ ...baseQuery(), ...overrides });
    if (generation !== summaryGeneration) return;
    patch({ summary, dataThrough: summary.data_through ?? state.dataThrough });
  } catch (error) {
    if (generation !== summaryGeneration) return;
    patch({ error: toMessage(error, "Failed to load pattern summary") });
  } finally {
    finishLoading();
  }
}

/**
 * Adopt an in-flight job (if any) after a page reload. Prefers a queued/running
 * job for the current universe+timeframe; a job for another combo is only kept
 * as a fallback reference and must not flip `scanning` for this view.
 */
export async function loadActiveJobs(): Promise<void> {
  try {
    const jobs = await fetchActiveJobs();
    const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
    const matching = active.find(
      (job) => job.universe === state.universe && job.timeframe === state.timeframe,
    );
    if (matching) {
      patch({ job: matching, scanning: true });
      void pollJob(matching.job_id);
      return;
    }
    if (active.length > 0) {
      if (!state.job) patch({ job: active[0] });
      return;
    }
    if (jobs.length > 0 && !state.job) {
      patch({ job: jobs[0] });
    }
  } catch {
    // Non-fatal: the page still works without a known active job.
  }
}

/**
 * True when the active combo's last completed scan is missing, unparseable, or
 * older than `STALE_SCAN_MINUTES`.
 */
function isScanStale(): boolean {
  const last = state.summary?.last_scan_at;
  if (!last) return true;
  const ts = Date.parse(last);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_SCAN_MINUTES * 60_000;
}

/**
 * True when any result-narrowing filter is active. An empty result set under a
 * restrictive filter is filter-caused, not a missing scan — so it must never
 * trigger an automatic scan. (`sort` is ordering-only, not restrictive;
 * `trendlines` is a client-only view filter, never restrictive.)
 */
export function hasRestrictiveFilter(filters: PatternFilters): boolean {
  return (
    filters.family.length > 0 ||
    filters.pattern_id.length > 0 ||
    filters.direction.length > 0 ||
    filters.status.length > 0 ||
    filters.quality != null ||
    filters.formed_within_bars != null ||
    filters.volume_confirmed != null ||
    filters.min_rr != null ||
    (filters.symbol != null && filters.symbol !== "") ||
    filters.symbols.length > 0 ||
    (filters.q != null && filters.q !== "") ||
    filters.min_base_days != null ||
    filters.max_range_pct != null
  );
}

/**
 * Auto-submit a scan for the active universe+timeframe when its last completed
 * scan is missing/stale — including when hits are present but were produced by
 * an older detector (those payloads lack trendlines/pivots). Skips while a scan
 * is already in flight and at most once per combination this session.
 * Only universe/timeframe transitions call this; filter-only changes never do.
 */
function maybeAutoScan(): void {
  if (state.scanning) return;
  const { universe, timeframe } = state;
  if (!universe || !timeframe) return;
  const custom = universe === CUSTOM_UNIVERSE;
  // A custom scope with no symbols has nothing to scan.
  if (custom && state.filters.symbols.length === 0) return;
  // Results are present and fresh: nothing to refresh.
  if (state.results.length > 0 && !isScanStale()) return;
  // Empty under a restrictive filter is filter-caused, not a missing scan.
  // In a custom scope the symbols ARE the scope (not a narrowing filter), so
  // they must not suppress the scan of that scope.
  const restrictive = custom
    ? hasRestrictiveFilter({ ...state.filters, symbols: [] })
    : hasRestrictiveFilter(state.filters);
  if (state.results.length === 0 && restrictive) return;
  const active = state.job;
  const activeForCombo =
    !!active &&
    (active.status === "queued" || active.status === "running") &&
    active.universe === universe &&
    active.timeframe === timeframe;
  if (activeForCombo) return;
  // A custom scope is keyed by its symbol set, so changing the set re-scans.
  const key = custom
    ? `${universe}:${[...state.filters.symbols].sort().join(",")}|${timeframe}`
    : `${universe}|${timeframe}`;
  if (autoScanRequested.has(key)) return;
  // The key is recorded only after the scan is successfully enqueued (inside
  // `triggerScan`), so a 429/network failure leaves the combo retryable.
  // Capture the combo now: `triggerScan` awaits, and state may move meanwhile.
  void triggerScan(false, { universe, timeframe, autoKey: key });
}

function jobFromScan(
  jobId: string,
  status: JobStatus,
  queuePosition: number | null,
  universe: string,
  timeframe: string,
): JobDTO {
  return {
    job_id: jobId,
    universe,
    timeframe,
    status,
    total: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    queue_position: queuePosition,
    started_at: null,
    finished_at: null,
    data_through: null,
    error: null,
  };
}

/** Start a scan and begin polling. Defaults to the active combo, but callers
 * (notably `maybeAutoScan`) may pin an explicit universe/timeframe — the
 * request must use those, not whatever state holds when the await resolves.
 * `autoKey` (a `universe|timeframe` once-per-combo key) is recorded only after
 * the scan is successfully enqueued, so failures stay retryable. */
export async function triggerScan(
  force = false,
  overrides: { universe?: string; timeframe?: string; autoKey?: string } = {},
): Promise<void> {
  const universe = overrides.universe ?? state.universe;
  const timeframe = overrides.timeframe ?? state.timeframe;
  const symbols = universe === CUSTOM_UNIVERSE ? state.filters.symbols : undefined;
  const lookback = state.lookbackBars;
  patch({ error: null });
  try {
    const response = await startScan({
      universe,
      timeframe,
      force,
      symbols,
      ...(lookback != null ? { lookback_bars: lookback } : {}),
    });
    if (overrides.autoKey) autoScanRequested.add(overrides.autoKey);
    patch({
      job: jobFromScan(
        response.job_id,
        response.status,
        response.queue_position,
        universe,
        timeframe,
      ),
      scanning: true,
      error: null,
    });
    void pollJob(response.job_id);
  } catch (error) {
    if (error instanceof QueueFullError) {
      patch({
        scanning: false,
        error: error.message,
        job: state.job
          ? { ...state.job, queue_position: null }
          : null,
      });
      return;
    }
    patch({ scanning: false, error: toMessage(error, "Failed to start scan") });
  }
}

function stopPolling(): void {
  pollToken += 1;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Poll a job every `POLL_INTERVAL_MS` while it is queued/running. On completion
 * (or failure) polling stops and the results/summary are refreshed.
 */
export async function pollJob(jobId: string): Promise<void> {
  stopPolling();
  const token = pollToken;

  const tick = async (): Promise<void> => {
    if (token !== pollToken) return;
    try {
      const job = await fetchJob(jobId);
      if (token !== pollToken) return;
      patch({ job });

      if (isTerminal(job.status)) {
        stopPolling();
        patch({ scanning: false });
        if (job.status === "failed" && job.error) {
          patch({ error: job.error });
        }
        if (job.status === "completed") {
          // Reload the combo the job actually scanned. If the user moved to a
          // different universe/timeframe while it ran, its payload belongs to
          // the old view — reloading it here would clobber the new combo.
          if (job.universe === state.universe && job.timeframe === state.timeframe) {
            await Promise.all([loadResults({ offset: 0 }), loadSummary()]);
          }
        }
      }
    } catch (error) {
      if (token !== pollToken) return;
      stopPolling();
      patch({
        scanning: false,
        error: toMessage(error, "Lost connection while polling scan job"),
      });
    }
  };

  await tick();

  if (token === pollToken && state.scanning) {
    pollTimer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
  }
}

/** Re-fetch results + summary, resuming polling if a job is still active. */
export function refresh(): void {
  patch({ error: null });
  void loadResults({ offset: 0 });
  void loadSummary();
  if (state.job && (state.job.status === "queued" || state.job.status === "running")) {
    void pollJob(state.job.job_id);
  }
}

/** Reload results+summary for a new selection, then auto-scan if still empty. */
async function reloadSelection(overrides: Partial<PatternsQuery>): Promise<void> {
  await Promise.all([loadResults({ ...overrides, offset: 0 }), loadSummary(overrides)]);
  maybeAutoScan();
}

/** Switch timeframe and reload results/summary; clears the open symbol detail. */
export function selectTimeframe(timeframe: string): void {
  // No-op first: re-selecting the active value must not wipe the open detail.
  if (timeframe === state.timeframe) return;
  patch({ timeframe, selectedSymbol: null, detail: null, detailChart: null, error: null });
  void reloadSelection({ timeframe });
}

/** Switch universe and reload results/summary; clears the open symbol detail. */
export function selectUniverse(universe: string): void {
  // No-op first: re-selecting the active preset must not wipe the open detail.
  // Re-selecting `custom` is allowed (it may need a reload after clearing).
  if (universe === state.universe && universe !== CUSTOM_UNIVERSE) return;
  // Preset scopes are not symbol-scoped; entering custom keeps the current set.
  const symbols = universe === CUSTOM_UNIVERSE ? state.filters.symbols : [];
  patch({
    universe,
    filters: { ...state.filters, symbols },
    selectedSymbol: null,
    detail: null,
    detailChart: null,
    error: null,
  });
  void reloadSelection({});
}

/**
 * Set the custom symbol scope (switching to the `custom` universe) and reload.
 * Selecting symbols is what defines a custom scan — no preset universe needed.
 */
export function selectSymbols(symbols: string[]): void {
  const clean: string[] = [];
  const seen = new Set<string>();
  for (const raw of symbols ?? []) {
    const symbol = String(raw ?? "").trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    clean.push(symbol);
  }
  patch({
    universe: clean.length > 0 ? CUSTOM_UNIVERSE : state.universe,
    filters: { ...state.filters, symbols: clean },
    selectedSymbol: null,
    detail: null,
    detailChart: null,
    error: null,
  });
  void reloadSelection({});
}

/** Load the symbol drill-down (detail + chart) for the active timeframe. */
export async function loadSymbolDetail(symbol: string, timeframe?: string): Promise<void> {
  const tf = timeframe ?? state.timeframe;
  patch({ selectedSymbol: symbol, detail: null, detailChart: null, error: null });
  startLoading();
  try {
    const [detail, chart] = await Promise.all([
      fetchSymbolDetail(symbol, tf),
      fetchSymbolChart(
        symbol,
        tf,
        state.lookbackBars != null ? { lookbackBars: state.lookbackBars } : undefined,
      ),
    ]);
    if (state.selectedSymbol !== symbol) return;
    patch({ detail, detailChart: chart, error: null });
  } catch (error) {
    patch({ error: toMessage(error, `Failed to load ${symbol}`) });
  } finally {
    finishLoading();
  }
}

/** Reset all chart-pattern state (primarily for tests and route unmount). */
export function resetChartPatternsState(): void {
  stopPolling();
  inflight = 0;
  resultsGeneration = 0;
  summaryGeneration = 0;
  autoScanRequested.clear();
  state = createInitialState();
  notify();
}
