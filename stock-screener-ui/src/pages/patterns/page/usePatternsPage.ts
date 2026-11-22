import { batch, createEffect, createMemo, createSignal, mergeProps, onCleanup } from "solid-js";
import { useMediaQuery } from "@/ui";
import { fetchPatternImages } from "@/api/patternImages";
import { buildAppliedFilterChips } from "@/components/patterns/AppliedFilters";
import { lastNHitsPerTimeframe, type PatternMatrixRow } from "@/components/patterns/symbolMatrix";
import { filterByIndexGroup, type IndexGroup } from "@/config/indexGroups";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";
import type { PatternFilters, PatternHitDTO } from "@/types/chartPatterns";
import { usePatternMatrix } from "../patternMatrix";
import {
  fullscreenDedupeKey,
  fullscreenHitIdentity,
  usePatternFullscreen,
} from "../patternsFullscreen";
import {
  buildMatrixRows,
  sameFilters,
  sameSequenceFilterArgs,
  sequenceFilterArgs,
  sequenceHits,
  stepIndex,
  summarizeDisplay,
  usedMatrixTimeframes,
} from "../patternsDerived";
import { PATTERNS_CSV_COLUMNS } from "./csvColumns";
import type { PatternsPageProps, ViewMode } from "./types";

/**
 * Owns the Patterns page's local state, reactive derivations and event wiring.
 * `patternsDerived.ts` stays pure; everything with a signal or a DOM listener
 * lives here so the view layer can be assembled from narrow-props sections.
 */
export function usePatternsPage(props: PatternsPageProps) {
  // Solid props are getters — never destructure. Local accessors keep call
  // sites terse while staying lazy; the parent store drives reactivity.
  const timeframes = () => props.timeframes;
  const universes = () => props.universes;
  const patterns = () => props.patterns;
  const timeframe = () => props.timeframe;
  const setTimeframe = props.setTimeframe;
  const selectedTimeframes = () => props.selectedTimeframes ?? [props.timeframe];
  const setSelectedTimeframes = props.setSelectedTimeframes;
  const lookbackBars = () => props.lookbackBars;
  const setLookbackBars = props.setLookbackBars;
  const universe = () => props.universe;
  const setUniverse = props.setUniverse;
  const filters = () => props.filters;
  const setFilter = props.setFilter;
  const resetFilters = props.resetFilters;
  const applyFilters = props.applyFilters;
  const computeTrendlines = () => props.computeTrendlines;
  const setComputeTrendlines = props.setComputeTrendlines;
  const customUniverse = () => props.customUniverse;
  const selectSymbols = props.selectSymbols;
  const job = () => props.job;
  const scanning = () => props.scanning;
  const queuePosition = () => props.queuePosition;
  const summary = () => props.summary;
  const results = () => props.results;
  const total = () => props.total;
  const streaming = () => props.streaming ?? false;
  const loading = () => props.loading;
  const error = () => props.error;
  const scan = props.scan;
  const refresh = props.refresh;
  const forceRefresh = props.forceRefresh;
  const scanReplay = props.scanReplay;
  const replayAsOf = () => props.replayAsOf ?? null;
  const effectiveTrendlinesView = createMemo(() =>
    computeTrendlines() ? (filters().trendlines ?? "both") : "none",
  );
  const {
    fullscreen,
    openFromCard,
    openFromSymbol,
    previewFromSymbol,
    pinFullscreen,
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    refreshSymbolChart,
    selectFullscreenHit,
    closeFullscreen,
  } = usePatternFullscreen({
    timeframe: timeframe(),
    lookbackBars: lookbackBars(),
    computeTrendlines: computeTrendlines(),
    // Universe/timeframe identity only — filter edits (search, direction…)
    // must not close the open chart. A scope change does.
    scopeKey: () => `${universe()}|${timeframe()}`,
    // Exactly one re-resolution per completed scan: the timestamp changes
    // once when the job finishes, not once per rendered item.
    resolutionKey: () => summary()?.last_scan_at ?? job()?.finished_at ?? null,
  });

  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const [chartMaximized, setChartMaximized] = createSignal(false);

  const previewTimerRef = { current: (null) as number | null };
  const previewCloseTimerRef = { current: (null) as number | null };
  const fullscreenRef = { current: (fullscreen()) };
  createEffect(() => {
    fullscreenRef.current = fullscreen();
  });
  const clearPreviewTimers = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  };
  createEffect(() => clearPreviewTimers);

  const closeChart = () => batch(() => {
    setChartMaximized(false);
    closeFullscreen();
  });
  const openChartHit = (hit: PatternHitDTO | null) => {
      if (!hit) return;
      const current = fullscreen();
      if (
        current?.hit &&
        fullscreenHitIdentity(current.hit) === fullscreenHitIdentity(hit)
      ) {
        return;
      }
      clearPreviewTimers();
      openFromCard(hit);
    };
  const chartViewProps = mergeProps(() => ({
    symbol: fullscreen()?.symbol ?? null,
    hit: fullscreen()?.hit ?? null,
    hits: fullscreen()?.hits ?? [],
    onSelectHit: selectFullscreenHit,
    candles: fullscreen()?.candles ?? [],
    overlays: [],
    trendLines: fullscreen()?.trendLines ?? [],
    trendlinesView: effectiveTrendlinesView(),
    timeframe: fullscreen()?.timeframe,
    timeframes: timeframes(),
    onTimeframeChange: changeFullscreenTimeframe,
    loading: fullscreen()?.loading ?? false,
    asOf: fullscreen()?.asOf ?? null,
    fromDate: fullscreen()?.fromDate ?? null,
    onAsOfChange: changeFullscreenAsOf,
    onRefresh: refreshSymbolChart,
    chartError: fullscreen()?.chartError ?? null,
    chartNote: fullscreen()?.chartNote ?? null,
    livePrice: fullscreen()?.livePrice ?? null,
    liveChange: fullscreen()?.liveChange ?? null,
  }));
  const [filtersOpen, setFiltersOpen] = createSignal(false);
  const [internalView, setInternalView] = createSignal<ViewMode>(props.defaultView ?? "matrix");
  const view = createMemo(() => props.view ?? internalView());
  const changeView = (next: ViewMode) => {
      if (props.setView) props.setView(next);
      else setInternalView(next);
    };
  const [internalIndexGroup, setInternalIndexGroup] = createSignal<IndexGroup>("all");
  const indexGroup = createMemo(() => props.indexGroup ?? internalIndexGroup());
  const changeIndexGroup = (next: IndexGroup) => {
      if (props.setIndexGroup) props.setIndexGroup(next);
      else setInternalIndexGroup(next);
    };
  const [internalMembers, setInternalMembers] = createSignal<string | null>(null);
  const members = createMemo(() => props.members ?? internalMembers());
  const changeMembers = (indexId: string | null) => {
      if (props.setMembers) props.setMembers(indexId);
      else setInternalMembers(indexId);
    };
  const tfSelection = createMemo(() => (selectedTimeframes().length > 0 ? selectedTimeframes() : [timeframe()]));
  const { data: matrixData, loading: matrixLoading, error: matrixError } =
    usePatternMatrix(
      () => universe(),
      () => view() === "matrix",
      () => summary()?.last_scan_at ?? summary()?.data_through ?? null,
      () => tfSelection(),
    );
  // Narrow filter slices: an edit to `q`/`sort` must not invalidate the
  // result-scanning memos below. The sequence slice uses structural equality
  // so its identity survives irrelevant filter edits.
  const sequenceArgs = createMemo(
    () => sequenceFilterArgs(filters()),
    undefined,
    { equals: sameSequenceFilterArgs },
  );
  const historyN = createMemo(() => filters().history ?? 1);
  const resultCount = createMemo(() => results().length);
  const customSymbolCount = createMemo(() => filters().symbols?.length ?? 0);
  const sequencedResults = createMemo(() => sequenceHits(results(), sequenceArgs()));

  // The matrix endpoint ignores the filters (it returns the whole universe), so
  // narrow its rows to the filtered/sequenced symbols and show their hits.
  const matrixRows = createMemo(() =>
    buildMatrixRows(matrixData()?.rows ?? [], sequencedResults(), historyN()),
  );
  const latestResults = createMemo(() => lastNHitsPerTimeframe(sequencedResults(), historyN()));
  const activeIndexGroup = createMemo((): IndexGroup => universe() === "indices" ? indexGroup() : "all");
  const filteredLatest = createMemo(() => filterByIndexGroup(latestResults(), activeIndexGroup()));
  const filteredMatrixRows = createMemo(() => filterByIndexGroup(matrixRows(), activeIndexGroup()));
  const displaySummary = createMemo(() =>
    summarizeDisplay(summary(), filteredLatest(), resultCount(), total()),
  );
  const matrixTimeframes = createMemo(() => usedMatrixTimeframes(matrixData()));
  const matrixVisibleTimeframes = createMemo(() => matrixTimeframes().filter((tf) => tfSelection().includes(tf)));
  const hasRows = createMemo(() => view() === "matrix" ? filteredMatrixRows().length > 0 : filteredLatest().length > 0);
  const emptyCustom = createMemo(() => universe() === customUniverse() && customSymbolCount() === 0);
  const [internalTab, setInternalTab] = createSignal<"scan" | "watch">("scan");
  const activeTab = createMemo(() => props.tab ?? internalTab());
  const handleTabChange = (value: string | null) => {
      if (value !== "scan" && value !== "watch") return;
      if (props.setTab) props.setTab(value);
      else setInternalTab(value);
    };
  const [draftFilters, setDraftFilters] = createSignal<PatternFilters>(filters());
  createEffect(() => {
    if (filtersOpen()) setDraftFilters(filters());
  });
  const setDraftFilter = (key: string, value: unknown): void => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }) as PatternFilters);
  };
  const resetDraft = (): void => setDraftFilters(DEFAULT_PATTERN_FILTERS);
  const applyDraftPreset = (patch: Partial<PatternFilters>): void => {
    // A preset is a complete filter state: merge onto defaults so keys it does
    // not mention are reset (matching the rail's documented contract) instead
    // of inheriting whatever was staged before. The symbol scope is exempt —
    // applying a preset must not silently empty a custom universe.
    setDraftFilters((prev) => ({
      ...DEFAULT_PATTERN_FILTERS,
      ...patch,
      symbols: prev.symbols,
      symbol: prev.symbol,
    }));
  };
  const applyDraft = (): void => batch(() => {
    applyFilters(draftFilters());
    setFiltersOpen(false);
  });
  const cancelDraft = (): void => batch(() => {
    setDraftFilters(filters());
    setFiltersOpen(false);
  });
  // Keyboard: `/` focuses results search, `f` opens the filter modal,
  // ⌘/Ctrl+Enter applies the staged filters. Ignored while typing.
  // Latest draft in a ref so typing inside the modal does not re-register the
  // window listener on every keystroke.
  const draftFiltersRef = { current: draftFilters() };
  // Keep the ref in sync in its own effect: the keydown effect must not depend
  // on `draftFilters()` or it would re-register the window listener each edit.
  createEffect(() => {
    draftFiltersRef.current = draftFilters();
  });
  createEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (filtersOpen() && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        batch(() => {
          applyFilters(draftFiltersRef.current);
          setFiltersOpen(false);
        });
        return;
      }
      // Filters / paste / fullscreen dialogs own the keyboard while open.
      if (target?.closest('[role="dialog"]')) return;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        document
          .querySelector<HTMLInputElement>('[data-testid="patterns-results-search"]')
          ?.focus();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFiltersOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const [patternImages, setPatternImages] = createSignal<Record<string, string>>({});
  // Single source of truth for the badge: the same chips rendered below the
  // toolbar, so "Filters (n)" can never disagree with what is on screen.
  const activeChips = createMemo(() => buildAppliedFilterChips(filters(), patterns()));
  const activeFilterCount = createMemo(() => activeChips().length);
  const activeFilterGroups = createMemo(() => Array.from(new Set(activeChips().map((chip) => chip.group))));
  const draftDirty = createMemo(() => !sameFilters(draftFilters(), filters()));
  const draftChipCount = createMemo(() => buildAppliedFilterChips(draftFilters(), patterns()).length);
  const scanActive = createMemo(() => scanning() || job()?.status === "running" || job()?.status === "queued");
  const refreshing = createMemo(() => (view() === "matrix" ? matrixLoading() : loading()));
  const [showRefresh, setShowRefresh] = createSignal(false);
  createEffect(() => {
    if (!refreshing()) {
      setShowRefresh(false);
      return;
    }
    const timer = window.setTimeout(() => setShowRefresh(true), 200);
    onCleanup(() => window.clearTimeout(timer));
  });

  const toggleFilterValue = (key: "status" | "direction", value: string): void => {
      const current = (filters()[key] ?? []) as string[];
      setFilter(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
    };

  const { copyMsg, copyFailed, copyRows, copySymbols } = useCopyFeedback();
  const handleCopyCsv = (): void => {
    void copyRows(filteredLatest(), PATTERNS_CSV_COLUMNS);
  };
  const handleCopySymbols = (): void => {
    void copySymbols(filteredLatest());
  };

  createEffect(() => {
    if (!filtersOpen()) return;
    let active = true;
    fetchPatternImages()
      .then((map) => {
        if (active) setPatternImages(map);
      })
      .catch(() => {
        /* non-fatal: tiles fall back to placeholders */
      });
    return () => {
      active = false;
    };
  });

  // ---- Docked chart sequence: prev/next + keyboard -----------------------
  // The table re-sorts internally when a header is clicked, so step through
  // the rows it actually rendered (emitted by TanStackTable) rather than the
  // server order. The matrix emits its filtered+sorted rows, which also makes
  // the multi-timeframe `row.best` match the hit the click opens.
  const [listOrder, setListOrder] = createSignal<PatternHitDTO[] | null>(null);
  const [matrixOrder, setMatrixOrder] = createSignal<PatternMatrixRow[] | null>(null);
  const dockSequence = createMemo(() => {
    if (view() === "matrix") {
      return (matrixOrder() ?? filteredMatrixRows()).flatMap((row) =>
        row.best ? [row.best] : [],
      );
    }
    return view() === "list" ? (listOrder() ?? filteredLatest()) : filteredLatest();
  });
  const activeHitKey = createMemo(() => fullscreen()?.hit ? fullscreenDedupeKey(fullscreen()!.hit!) : null);
  const activeIndex = createMemo(() =>
      activeHitKey()
        ? dockSequence().findIndex((hit) => fullscreenDedupeKey(hit) === activeHitKey())
        : -1);
  const stepChart = (delta: number) => {
      const sequence = dockSequence();
      const next = stepIndex(sequence.length, activeIndex(), delta);
      const hit = sequence[next];
      if (hit) openFromCard(hit);
    };

  // ---- Symbol hover preview (right rail, Scan tab only) ------------------
  // Preview only while nothing is pinned: once the user picks a chart, moving
  // the mouse across the results must not replace it.
  const canPreview = createMemo(() => isDesktop() && activeTab() === "scan" && !scanning());
  const requestSymbolPreview = (symbol: string) => {
      if (!canPreview() || fullscreen()?.pinned) return;
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(() => {
        previewFromSymbol(symbol);
      }, 300);
    };
  const endSymbolPreview = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const current = fullscreen();
    if (!canPreview() || !current || current.pinned) return;
    if (previewCloseTimerRef.current) window.clearTimeout(previewCloseTimerRef.current);
    // Grace window so moving the pointer from the symbol into the rail does
    // not dismiss the preview before the rail's mouseenter lands.
    previewCloseTimerRef.current = window.setTimeout(() => {
      if (fullscreenRef.current && !fullscreenRef.current.pinned) {
        closeFullscreen();
      }
    }, 800);
  };
  const cancelPreviewClose = () => {
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  };
  const openSymbolPinned = (symbol: string) => {
      clearPreviewTimers();
      openFromSymbol(symbol);
    };

  createEffect(() => {
    if (!isDesktop() || !fullscreen() || filtersOpen() || activeTab() !== "scan") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='option']",
        )
      ) {
        return;
      }
      // Filters / paste / members() own the keyboard. The chart modal is the
      // exception: arrows keep stepping while it is maximized.
      if (
        document.querySelector(
          '[role="dialog"]:not([data-testid="patterns-fullscreen-modal"])',
        )
      ) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        stepChart(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        stepChart(-1);
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (chartMaximized()) setChartMaximized(false);
        else closeChart();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  createEffect(() => {
    if (activeIndex() < 0) return;
    const row = document.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  });

  const prevTabRef = { current: (activeTab()) };
  createEffect(() => {
    if (prevTabRef.current === "scan" && activeTab() !== "scan" && fullscreen()) {
      batch(() => {
        setChartMaximized(false);
        closeFullscreen();
      });
    }
    prevTabRef.current = activeTab();
  });

  return {
    timeframes,
    universes,
    patterns,
    timeframe,
    setTimeframe,
    setSelectedTimeframes,
    lookbackBars,
    setLookbackBars,
    universe,
    setUniverse,
    filters,
    setFilter,
    resetFilters,
    computeTrendlines,
    setComputeTrendlines,
    customUniverse,
    selectSymbols,
    job,
    scanning,
    queuePosition,
    summary,
    results,
    total,
    streaming,
    loading,
    error,
    scan,
    refresh,
    forceRefresh,
    scanReplay,
    replayAsOf,
    effectiveTrendlinesView,
    filtersOpen,
    setFiltersOpen,
    view,
    changeView,
    indexGroup,
    changeIndexGroup,
    members,
    changeMembers,
    tfSelection,
    activeTab,
    handleTabChange,
    draftFilters,
    setDraftFilter,
    resetDraft,
    applyDraftPreset,
    applyDraft,
    cancelDraft,
    draftDirty,
    draftChipCount,
    patternImages,
    activeChips,
    activeFilterCount,
    activeFilterGroups,
    scanActive,
    showRefresh,
    matrixLoading,
    matrixError,
    filteredLatest,
    filteredMatrixRows,
    matrixVisibleTimeframes,
    displaySummary,
    hasRows,
    emptyCustom,
    fullscreen,
    chartViewProps,
    chartMaximized,
    setChartMaximized,
    openChartHit,
    openFromCard,
    openFromSymbol,
    pinFullscreen,
    changeFullscreenAsOf,
    closeChart,
    stepChart,
    activeIndex,
    dockSequence,
    requestSymbolPreview,
    endSymbolPreview,
    cancelPreviewClose,
    openSymbolPinned,
    setMatrixOrder,
    setListOrder,
    copyMsg,
    copyFailed,
    handleCopyCsv,
    handleCopySymbols,
    isDesktop,
    toggleFilterValue,
  };
}

export type PatternsPageModel = ReturnType<typeof usePatternsPage>;
