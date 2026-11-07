import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Alert, Box, Button, Chip, Divider, Loader, LoadingOverlay, Menu, MenuDropdown, MenuItem, MenuTarget, Modal, SegmentedControl, Select, Switch, Tabs, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconAdjustmentsHorizontal, IconDotsVertical } from "@tabler/icons-react";
import type {
  JobDTO,
  PatternDef,
  PatternFilters,
  PatternHitDTO,
  PatternSummary,
  TFSpec,
  Universe,
} from "@/types/chartPatterns";
import { fetchPatternImages } from "@/api/patternImages";
import { UniverseBar } from "@/components/patterns/UniverseBar";
import { ScanStats } from "@/components/patterns/ScanStats";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import { TimeframeSelect } from "@/components/patterns/TimeframeSelect";
import { LookbackSelect } from "@/components/patterns/LookbackSelect";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { ResultsSearch } from "@/components/patterns/ResultsSearch";
import { PatternGrid } from "@/components/patterns/PatternGrid";
import { PatternListView } from "@/components/patterns/PatternListView";
import { IndexMembersDrawer } from "@/components/patterns/IndexMembersDrawer";
import { PatternSymbolMatrix } from "@/components/patterns/PatternSymbolMatrix";
import {
  lastNHitsPerTimeframe,
  mergeMatrixQuotes,
  type PatternMatrixRow,
} from "@/components/patterns/symbolMatrix";
import { selectLastN } from "@/components/patterns/selectLastN";
import { matchSequence } from "@/components/patterns/sequenceMatch";
import { filterByIndexGroup, type IndexGroup } from "@/config/indexGroups";
import { usePatternMatrix } from "@/hooks/usePatternMatrix";
import { ScanProgress, ScanCacheChip } from "@/components/patterns/ScanProgress";
import { AppliedFilters, buildAppliedFilterChips } from "@/components/patterns/AppliedFilters";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import {
  fullscreenDedupeKey,
  fullscreenHitIdentity,
  usePatternFullscreen,
} from "@/hooks/usePatternFullscreen";
import useMediaQuery from "@mui/material/useMediaQuery";
import { ReplayScanControl, type ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import { WatchView } from "@/components/patterns/WatchView";
import { formatAsOfLabel } from "@/components/patterns/datetime";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import type { CsvColumn } from "@/utils/copyCsv";
import { useCopyFeedback } from "@/hooks/useCopyFeedback";

/** CSV columns for the pattern results export (flat card-DTO fields). */
export const PATTERNS_CSV_COLUMNS: CsvColumn[] = [
  { key: "symbol", header: "Symbol" },
  { key: "pattern_id", header: "Pattern ID" },
  { key: "pattern_name", header: "Pattern" },
  { key: "family", header: "Family" },
  { key: "direction", header: "Direction" },
  { key: "status", header: "Status" },
  { key: "quality", header: "Quality" },
  { key: "confidence", header: "Confidence" },
  { key: "timeframe", header: "Timeframe" },
  { key: "start_date", header: "Start" },
  { key: "end_date", header: "End" },
  { key: "breakout_level", header: "Breakout" },
  { key: "target", header: "Target" },
  { key: "stop", header: "Stop" },
  { key: "rr", header: "R:R" },
  { key: "volume_confirmed", header: "Vol confirmed" },
  { key: "bars_ago", header: "Bars ago" },
];

/** Order-insensitive shallow comparison used for the modal's dirty check. */
function sameFilters(a: PatternFilters, b: PatternFilters): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PatternFilters>;
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) || Array.isArray(bv)) {
      const as = [...((av ?? []) as unknown[])].map(String).sort().join("|");
      const bs = [...((bv ?? []) as unknown[])].map(String).sort().join("|");
      if (as !== bs) return false;
    } else if ((av ?? null) !== (bv ?? null)) {
      return false;
    }
  }
  return true;
}

export interface PatternsPageProps {
  timeframes: TFSpec[];
  universes: Universe[];
  patterns: PatternDef[];
  timeframe: string;
  setTimeframe: (value: string) => void;
  selectedTimeframes?: string[];
  setSelectedTimeframes?: (value: string[]) => void;
  lookbackBars: number | null;
  setLookbackBars: (value: number | null) => void;
  universe: string;
  setUniverse: (value: string) => void;
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  resetFilters: () => void;
  applyFilters: (filters: Partial<PatternFilters>) => void;
  /** Skip server-side trendline computation + hide standalone lines. */
  computeTrendlines: boolean;
  setComputeTrendlines: (value: boolean) => void;
  /** Reserved id of the custom symbol scope (e.g. `"custom"`). */
  customUniverse: string;
  /** Set the custom symbol scope (switches to the custom universe) and reload. */
  selectSymbols: (symbols: string[]) => void;
  job: JobDTO | null;
  scanning: boolean;
  queuePosition: number | null;
  summary: PatternSummary | null;
  results: PatternHitDTO[];
  total: number;
  /** True while `/results/stream` is still appending items (progressive render). */
  streaming?: boolean;
  loading: boolean;
  error: string | null;
  scan: () => void;
  refresh: () => void;
  /** Clear cached candles for the scope + timeframe and re-scan fresh. */
  forceRefresh: () => void;
  /** Run an as-of replay scan (slower full-history recompute). */
  scanReplay?: (args: ReplayScanArgs) => void;
  /** Echo of the last replay scan cutoff (null = live); shown as a label. */
  replayAsOf?: string | null;
  /** Active workspace tab (default `scan`); controlled by the container for URL sync. */
  tab?: "scan" | "watch";
  setTab?: (tab: "scan" | "watch") => void;
  /** Initial results view (default `matrix`). */
  defaultView?: "matrix" | "list" | "grid";
  /** Controlled results view (URL-synced by the container). */
  view?: "matrix" | "list" | "grid";
  setView?: (view: "matrix" | "list" | "grid") => void;
  /** Index group filter (`all`|`big`|`others`); URL-synced by the container. */
  indexGroup?: IndexGroup;
  setIndexGroup?: (group: IndexGroup) => void;
  /** Index whose members drawer is open (null = closed); URL-synced. */
  members?: string | null;
  setMembers?: (indexId: string | null) => void;
}

/**
 * Patterns workspace: universe bar + stat strip on top, then a 2-column layout
 * (filter rail | card grid). Clicking a card opens the fullscreen chart.
 */
export function PatternsPage({
  timeframes,
  universes,
  patterns,
  timeframe,
  setTimeframe,
  selectedTimeframes = [timeframe],
  setSelectedTimeframes,
  lookbackBars,
  setLookbackBars,
  universe,
  setUniverse,
  filters,
  setFilter,
  resetFilters,
  applyFilters,
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
  streaming = false,
  loading,
  error,
  scan,
  refresh,
  forceRefresh,
  scanReplay,
  replayAsOf = null,
  tab: tabProp,
  setTab: setTabProp,
  defaultView = "matrix",
  view: viewProp,
  setView: setViewProp,
  indexGroup: indexGroupProp,
  setIndexGroup: setIndexGroupProp,
  members: membersProp,
  setMembers: setMembersProp,
}: PatternsPageProps) {
  // Fullscreen pattern chart, shared with the Daily Report page: identical
  // open/timeframe/as-of/select behaviour via `usePatternFullscreen`.
  // Top-level compute toggle off: draw no standalone trendlines anywhere,
  // regardless of the view-only `trendlines` filter.
  const effectiveTrendlinesView = computeTrendlines ? (filters.trendlines ?? "both") : "none";
  const {
    fullscreen,
    openFromCard,
    openFromSymbol,
    previewFromSymbol,
    pinFullscreen,
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    selectFullscreenHit,
    closeFullscreen,
  } = usePatternFullscreen({
    timeframe,
    lookbackBars,
    computeTrendlines,
    // Universe/timeframe identity only — filter edits (search, direction…)
    // must not close the open chart. A scope change does.
    scopeKey: `${universe}|${timeframe}`,
    // Exactly one re-resolution per completed scan: the timestamp changes
    // once when the job finishes, not once per rendered item.
    resolutionKey: summary?.last_scan_at ?? job?.finished_at ?? null,
  });

  // Docked chart inspector: at >=lg a click opens the chart beside the
  // results (fast row-to-row switching without a modal round-trip);
  // below lg the same selection opens the fullscreen modal.
  const isDesktop = useMediaQuery("(min-width: 1200px)");
  const [chartMaximized, setChartMaximized] = useState(false);

  // Symbol hover-preview timers (declared early so row clicks can cancel a
  // pending hover before it replaces the pinned chart).
  const previewTimerRef = useRef<number | null>(null);
  const previewCloseTimerRef = useRef<number | null>(null);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const clearPreviewTimers = useCallback(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  }, []);
  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  const closeChart = useCallback(() => {
    setChartMaximized(false);
    closeFullscreen();
  }, [closeFullscreen]);
  const openChartHit = useCallback(
    (hit: PatternHitDTO) => {
      if (
        fullscreen?.hit &&
        fullscreenHitIdentity(fullscreen.hit) === fullscreenHitIdentity(hit)
      ) {
        return;
      }
      clearPreviewTimers();
      openFromCard(hit);
    },
    [fullscreen, openFromCard, clearPreviewTimers],
  );
  const chartViewProps = {
    symbol: fullscreen?.symbol ?? null,
    hit: fullscreen?.hit ?? null,
    hits: fullscreen?.hits ?? [],
    onSelectHit: selectFullscreenHit,
    candles: fullscreen?.candles ?? [],
    overlays: [],
    trendLines: fullscreen?.trendLines ?? [],
    trendlinesView: effectiveTrendlinesView,
    timeframe: fullscreen?.timeframe,
    timeframes,
    onTimeframeChange: changeFullscreenTimeframe,
    loading: fullscreen?.loading ?? false,
    asOf: fullscreen?.asOf ?? null,
    fromDate: fullscreen?.fromDate ?? null,
    onAsOfChange: changeFullscreenAsOf,
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Dense results view: symbol `matrix` (default), per-hit `list`, or card `grid`. */
  const [internalView, setInternalView] = useState<"matrix" | "list" | "grid">(defaultView);
  const view = viewProp ?? internalView;
  const changeView = useCallback(
    (next: "matrix" | "list" | "grid") => {
      if (setViewProp) setViewProp(next);
      else setInternalView(next);
    },
    [setViewProp],
  );
  const [internalIndexGroup, setInternalIndexGroup] = useState<IndexGroup>("all");
  const indexGroup = indexGroupProp ?? internalIndexGroup;
  const changeIndexGroup = useCallback(
    (next: IndexGroup) => {
      if (setIndexGroupProp) setIndexGroupProp(next);
      else setInternalIndexGroup(next);
    },
    [setIndexGroupProp],
  );
  const [internalMembers, setInternalMembers] = useState<string | null>(null);
  const members = membersProp ?? internalMembers;
  const changeMembers = useCallback(
    (indexId: string | null) => {
      if (setMembersProp) setMembersProp(indexId);
      else setInternalMembers(indexId);
    },
    [setMembersProp],
  );
  const tfSelection = useMemo(
    () => (selectedTimeframes.length > 0 ? selectedTimeframes : [timeframe]),
    [selectedTimeframes, timeframe],
  );
  const matrix = usePatternMatrix(
    universe,
    view === "matrix",
    summary?.last_scan_at ?? summary?.data_through ?? null,
    tfSelection,
  );
  const sequencedResults = useMemo(() => {
    if (!filters.sequence || (filters.pattern_id?.length ?? 0) < 2) return results;
    const bySymbol = new Map<string, PatternHitDTO[]>();
    for (const h of results) {
      const key = `${h.symbol}|${h.timeframe}`;
      const group = bySymbol.get(key);
      if (group) group.push(h);
      else bySymbol.set(key, [h]);
    }
    const keep = new Set<number>();
    for (const group of bySymbol.values()) {
      for (const h of matchSequence(group, filters.pattern_id, {
        maxGapDays: filters.sequence_gap_days ?? 20,
        maxBarsAgo: filters.sequence_max_bars ?? null,
        stepStatuses: filters.sequence_step_status ?? [],
      })) {
        if (h.id != null) keep.add(h.id);
      }
    }
    return results.filter((h) => h.id != null && keep.has(h.id));
  }, [
    results,
    filters.sequence,
    filters.pattern_id,
    filters.sequence_gap_days,
    filters.sequence_max_bars,
    filters.sequence_step_status,
  ]);

  const hitsBySymbol = useMemo(() => {
    const grouped = new Map<string, PatternHitDTO[]>();
    for (const hit of sequencedResults) {
      const group = grouped.get(hit.symbol);
      if (group) group.push(hit);
      else grouped.set(hit.symbol, [hit]);
    }
    return grouped;
  }, [sequencedResults]);

  // The matrix endpoint ignores the filters (it returns the whole universe), so
  // narrow its rows to the filtered/sequenced symbols and show their hits.
  const matrixRows = useMemo(() => {
    const n = filters.history ?? 1;
    return mergeMatrixQuotes(matrix.data?.rows ?? [], sequencedResults)
      .filter((row) => hitsBySymbol.has(row.symbol))
      .map((row) => ({
        ...row,
        hits: selectLastN(hitsBySymbol.get(row.symbol) ?? [], n),
        hit_count: (hitsBySymbol.get(row.symbol) ?? []).length,
      }));
  }, [matrix.data, sequencedResults, hitsBySymbol, filters.history]);
  const latestResults = useMemo(
    () => lastNHitsPerTimeframe(sequencedResults, filters.history ?? 1),
    [sequencedResults, filters.history],
  );
  const activeIndexGroup: IndexGroup = universe === "indices" ? indexGroup : "all";
  const filteredLatest = useMemo(
    () => filterByIndexGroup(latestResults, activeIndexGroup),
    [latestResults, activeIndexGroup],
  );
  const filteredMatrixRows = useMemo(
    () => filterByIndexGroup(matrixRows, activeIndexGroup),
    [matrixRows, activeIndexGroup],
  );
  const displaySummary = useMemo(() => {
    if (!summary || results.length < total) return summary;
    const patternCounts: Record<string, number> = {};
    const familyCounts: Record<string, number> = {};
    let confirmed = 0;
    let bullish = 0;
    let bearish = 0;
    for (const hit of filteredLatest) {
      if (hit.status === "confirmed") confirmed += 1;
      if (hit.direction === "bullish") bullish += 1;
      if (hit.direction === "bearish") bearish += 1;
      patternCounts[hit.pattern_id] = (patternCounts[hit.pattern_id] ?? 0) + 1;
      familyCounts[hit.family] = (familyCounts[hit.family] ?? 0) + 1;
    }
    return {
      ...summary,
      patterns: filteredLatest.length,
      in_view: filteredLatest.length,
      confirmed,
      bullish,
      bearish,
      pattern_counts: patternCounts,
      family_counts: familyCounts,
    };
  }, [summary, results.length, total, filteredLatest]);
  const matrixTimeframes = useMemo(() => {
    const used = new Set<string>();
    for (const row of matrix.data?.rows ?? []) {
      for (const tf of Object.keys(row.timeframes)) used.add(tf);
    }
    return (matrix.data?.timeframes ?? []).filter((tf) => used.has(tf));
  }, [matrix.data]);
  const matrixVisibleTimeframes = useMemo(
    () => matrixTimeframes.filter((tf) => tfSelection.includes(tf)),
    [matrixTimeframes, tfSelection],
  );
  const hasRows = view === "matrix" ? filteredMatrixRows.length > 0 : filteredLatest.length > 0;
  const emptyCustom = universe === customUniverse && (filters.symbols?.length ?? 0) === 0;
  // Workspace tab: controlled by the container (URL sync) when provided,
  // otherwise local state defaulting to the scan view.
  const [internalTab, setInternalTab] = useState<"scan" | "watch">("scan");
  const activeTab = tabProp ?? internalTab;
  const handleTabChange = useCallback(
    (value: string | null) => {
      if (value !== "scan" && value !== "watch") return;
      if (setTabProp) setTabProp(value);
      else setInternalTab(value);
    },
    [setTabProp],
  );
  // Filter edits are staged in a draft and only applied when the user clicks
  // "Filter" — changing a control no longer triggers an instant reload.
  const [draftFilters, setDraftFilters] = useState<PatternFilters>(filters);
  useEffect(() => {
    if (filtersOpen) setDraftFilters(filters);
  }, [filtersOpen]);
  const setDraftFilter = useCallback((key: string, value: unknown): void => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }) as PatternFilters);
  }, []);
  const resetDraft = useCallback((): void => setDraftFilters(DEFAULT_PATTERN_FILTERS), []);
  const applyDraftPreset = useCallback((patch: Partial<PatternFilters>): void => {
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
  }, []);
  const applyDraft = useCallback((): void => {
    applyFilters(draftFilters);
    setFiltersOpen(false);
  }, [applyFilters, draftFilters]);
  const cancelDraft = useCallback((): void => {
    setDraftFilters(filters);
    setFiltersOpen(false);
  }, [filters]);
  // Keyboard: `/` focuses results search, `f` opens the filter modal,
  // ⌘/Ctrl+Enter applies the staged filters. Ignored while typing.
  // Latest draft in a ref so typing inside the modal does not re-register the
  // window listener on every keystroke.
  const draftFiltersRef = useRef(draftFilters);
  draftFiltersRef.current = draftFilters;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (filtersOpen && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        applyFilters(draftFiltersRef.current);
        setFiltersOpen(false);
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
  }, [filtersOpen, applyFilters]);
  const [patternImages, setPatternImages] = useState<Record<string, string>>({});
  // Single source of truth for the badge: the same chips rendered below the
  // toolbar, so "Filters (n)" can never disagree with what is on screen.
  const activeChips = useMemo(
    () => buildAppliedFilterChips(filters, patterns),
    [filters, patterns],
  );
  const activeFilterCount = activeChips.length;
  const activeFilterGroups = useMemo(
    () => Array.from(new Set(activeChips.map((chip) => chip.group))),
    [activeChips],
  );
  const draftDirty = useMemo(() => !sameFilters(draftFilters, filters), [draftFilters, filters]);
  const draftChipCount = useMemo(
    () => buildAppliedFilterChips(draftFilters, patterns).length,
    [draftFilters, patterns],
  );
  const scanActive = scanning || job?.status === "running" || job?.status === "queued";

  /** Toggle one value of a multi-select filter (used by the clickable stats). */
  const toggleFilterValue = useCallback(
    (key: "status" | "direction", value: string): void => {
      const current = (filters[key] ?? []) as string[];
      setFilter(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
    },
    [filters, setFilter],
  );

  // Copy-to-clipboard feedback for the results export (shared hook).
  const { copyMsg, copyFailed, copyRows, copySymbols } = useCopyFeedback();
  const handleCopyCsv = useCallback((): void => {
    void copyRows(filteredLatest, PATTERNS_CSV_COLUMNS);
  }, [copyRows, filteredLatest]);
  const handleCopySymbols = useCallback((): void => {
    void copySymbols(filteredLatest);
  }, [copySymbols, filteredLatest]);

  // Reference images for the pattern tiles: load once, the first time the
  // Filters modal opens (no cost on page load).
  useEffect(() => {
    if (!filtersOpen) return;
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
  }, [filtersOpen]);

  // ---- Docked chart sequence: prev/next + keyboard -----------------------
  // The table re-sorts internally when a header is clicked, so step through
  // the rows it actually rendered (emitted by TanStackTable) rather than the
  // server order. The matrix emits its filtered+sorted rows, which also makes
  // the multi-timeframe `row.best` match the hit the click opens.
  const [listOrder, setListOrder] = useState<PatternHitDTO[] | null>(null);
  const [matrixOrder, setMatrixOrder] = useState<PatternMatrixRow[] | null>(null);
  const dockSequence = useMemo(() => {
    if (view === "matrix") {
      return (matrixOrder ?? filteredMatrixRows).flatMap((row) =>
        row.best ? [row.best] : [],
      );
    }
    // Grid renders `filteredLatest` directly; only the sorted table needs its
    // emitted order.
    return view === "list" ? (listOrder ?? filteredLatest) : filteredLatest;
  }, [view, matrixOrder, filteredMatrixRows, listOrder, filteredLatest]);
  const activeHitKey = fullscreen?.hit ? fullscreenDedupeKey(fullscreen.hit) : null;
  const activeIndex = useMemo(
    () =>
      activeHitKey
        ? dockSequence.findIndex((hit) => fullscreenDedupeKey(hit) === activeHitKey)
        : -1,
    [dockSequence, activeHitKey],
  );
  const stepChart = useCallback(
    (delta: number) => {
      if (dockSequence.length === 0) return;
      const next =
        activeIndex >= 0
          ? (activeIndex + delta + dockSequence.length) % dockSequence.length
          : delta > 0
            ? 0
            : dockSequence.length - 1;
      const hit = dockSequence[next];
      if (hit) openFromCard(hit);
    },
    [dockSequence, activeIndex, openFromCard],
  );

  // ---- Symbol hover preview (right rail, Scan tab only) ------------------
  // Preview only while nothing is pinned: once the user picks a chart, moving
  // the mouse across the results must not replace it.
  const canPreview = isDesktop && activeTab === "scan" && !scanning;
  const requestSymbolPreview = useCallback(
    (symbol: string) => {
      if (!canPreview || fullscreen?.pinned) return;
      if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = window.setTimeout(() => {
        previewFromSymbol(symbol);
      }, 300);
    },
    [canPreview, fullscreen?.pinned, previewFromSymbol],
  );
  const endSymbolPreview = useCallback(() => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (!canPreview || !fullscreen || fullscreen.pinned) return;
    if (previewCloseTimerRef.current) window.clearTimeout(previewCloseTimerRef.current);
    // Grace window so moving the pointer from the symbol into the rail does
    // not dismiss the preview before the rail's mouseenter lands.
    previewCloseTimerRef.current = window.setTimeout(() => {
      if (fullscreenRef.current && !fullscreenRef.current.pinned) {
        closeFullscreen();
      }
    }, 800);
  }, [canPreview, fullscreen, closeFullscreen]);
  const cancelPreviewClose = useCallback(() => {
    if (previewCloseTimerRef.current) {
      window.clearTimeout(previewCloseTimerRef.current);
      previewCloseTimerRef.current = null;
    }
  }, []);
  const openSymbolPinned = useCallback(
    (symbol: string) => {
      clearPreviewTimers();
      openFromSymbol(symbol);
    },
    [clearPreviewTimers, openFromSymbol],
  );

  useEffect(() => {
    if (!isDesktop || !fullscreen || filtersOpen || activeTab !== "scan") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // MUI Select/Menu already handled the key.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], [role='menu'], [role='option']",
        )
      ) {
        return;
      }
      // Filters / paste / members own the keyboard. The chart modal is the
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
        if (chartMaximized) setChartMaximized(false);
        else closeChart();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop, fullscreen, filtersOpen, activeTab, stepChart, closeChart, chartMaximized]);

  // Keep the active row visible while stepping (the matrix windows its rows,
  // so this also brings a just-mounted row into view).
  useEffect(() => {
    if (activeIndex < 0) return;
    const row = document.querySelector('[data-active="true"]');
    row?.scrollIntoView?.({ block: "nearest" });
  }, [activeHitKey, activeIndex]);

  // The dock lives inside the Scan panel; leaving Scan dismisses it so a Watch
  // row click opens the modal instead of setting an invisible selection.
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current === "scan" && activeTab !== "scan" && fullscreen) {
      setChartMaximized(false);
      closeFullscreen();
    }
    prevTabRef.current = activeTab;
  }, [activeTab, fullscreen, closeFullscreen]);


  return (
    <Box
      data-testid="patterns-page"
      sx={{
        px: 1,
        py: 0.25,
        display: "flex",
        flexDirection: "column",
        gap: 0.25,
        width: "100%",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Tabs value={activeTab} onChange={handleTabChange} data-testid="patterns-tabs">
        <Tabs.List data-testid="patterns-tab-list">
          <Tabs.Tab value="scan" data-testid="patterns-tab-scan">
            Scan
          </Tabs.Tab>
          <Tabs.Tab value="watch" data-testid="patterns-tab-watch">
            Watch
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="scan" data-testid="patterns-panel-scan" sx={{ py: 0 }}>
      <ScanStats
        summary={displaySummary}
        job={job}
        onSelect={(kind) =>
          toggleFilterValue(kind === "confirmed" ? "status" : "direction", kind === "confirmed" ? "confirmed" : kind)
        }
      />
      <UniverseBar
        universes={universes}
        universe={universe}
        setUniverse={setUniverse}
        customUniverse={customUniverse}
        customSymbolCount={filters.symbols?.length ?? 0}
        onPasteSymbols={selectSymbols}
        scan={scan}
        scanning={scanning}
        job={job}
        queuePosition={queuePosition}
        error={error}
        scanActions={
          job?.status === "completed" && !scanActive ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
              <ScanCacheChip job={job} onForceRefresh={forceRefresh} />
              {/* The scan-session date is already shown by JobStatus
                  ("Last scan complete · through …"); the stat strip owns the
                  last-candle timestamp. No third duplicate stamp here. */}
            </Box>
          ) : null
        }
        actions={
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 0.25,
              width: "100%",
              minWidth: 0,
            }}
          >
            {/* Row 1 — scan setup: what to scan and how. */}
            <ToolbarRow
              justify="flex-start"
             
              gap={8}
              wrap={true}
              data-testid="patterns-results-toolbar"
            >
              <Box
                data-testid="patterns-scan-scope"
                sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}
              >
                <Box sx={{ width: 210, flexShrink: 0 }}>
                  <SymbolFilter
                    filters={filters}
                    setFilter={setFilter}
                    onChange={selectSymbols}
                    placeholder="Search symbol…"
                    helperText=""
                  />
                </Box>
              </Box>
              <Divider orientation="vertical" sx={{ height: 18, alignSelf: "center" }} />
              <TimeframeSelect
                timeframes={timeframes}
                value={tfSelection}
                onChange={(next) => {
                  if (setSelectedTimeframes) setSelectedTimeframes(next);
                  else setTimeframe(next[0] ?? timeframe);
                }}
              />
              <LookbackSelect value={lookbackBars} onChange={setLookbackBars} />
              <ReplayScanControl onReplayScan={scanReplay} />
              {replayAsOf ? (
                <Text size="xs" c="dimmed" data-testid="patterns-scan-asof">
                  {`as of ${formatAsOfLabel(replayAsOf)}`}
                </Text>
              ) : null}
              <Divider orientation="vertical" sx={{ height: 18, alignSelf: "center" }} />
              <Tooltip label="Draw standalone support / resistance lines (TLS = support, TLR = resistance)">
                <Box sx={{ display: "inline-flex" }}>
                  <Switch
                    label="TLS/TLR"
                    size="sm"
                    checked={computeTrendlines}
                    onChange={(e) => setComputeTrendlines(e.target.checked)}
                    data-testid="patterns-compute-trendlines"
                  />
                </Box>
              </Tooltip>
            </ToolbarRow>
            {/* Row 2 — results: how to read what came back. */}
            <ToolbarRow
              justify="flex-start"
             
              gap={8}
              wrap={true}
              data-testid="patterns-results-view-toolbar"
            >
              <SegmentedControl
                data={[
                  { value: "matrix", label: "Matrix" },
                  { value: "list", label: "List" },
                  { value: "grid", label: "Grid" },
                ]}
                value={view}
                onChange={(v) => {
                  if (v === "matrix" || v === "list" || v === "grid") changeView(v);
                }}
                size="xs"
                data-testid="patterns-view-toggle"
              />
              {universe === "indices" ? (
                <Select
                  data={[
                    { value: "all", label: "All" },
                    { value: "big", label: "Big" },
                    { value: "others", label: "Other" },
                  ]}
                  value={indexGroup}
                  onChange={(v) => {
                    if (v === "all" || v === "big" || v === "others") changeIndexGroup(v);
                  }}
                  leftSection={<Text size="xs" c="dimmed" style={{ fontSize: 10 }}>IDX</Text>}
                  w={106}
                  size="xs"
                  data-testid="patterns-index-group"
                />
              ) : null}
              {tfSelection.length > 1 ? (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontSize: 10, whiteSpace: "nowrap" }}
                  data-testid="patterns-multi-tf-hint"
                >
                  {`List/Grid: ${timeframe}`}
                </Text>
              ) : null}
              <Box sx={{ flex: 1, minWidth: 8 }} />
              <ResultsSearch filters={filters} setFilter={setFilter} />
              <Tooltip
                label={
                  activeFilterGroups.length > 0
                    ? `${activeFilterCount} active — ${activeFilterGroups.join(", ")}`
                    : "No filters applied (press F)"
                }
              >
                <Box sx={{ display: "inline-flex" }}>
                  <Button
                    size="xs"
                    variant="filled"
                    leftSection={<IconAdjustmentsHorizontal size={14} />}
                    onClick={() => setFiltersOpen(true)}
                    data-testid="patterns-open-filters"
                  >
                    {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
                  </Button>
                </Box>
              </Tooltip>
              <Menu data-testid="patterns-overflow-menu">
                <MenuTarget>
                  <ActionIcon
                    variant="outline"
                    size="sm"
                    aria-label="More actions"
                    data-testid="patterns-overflow"
                  >
                    <IconDotsVertical size={15} />
                  </ActionIcon>
                </MenuTarget>
                <MenuDropdown data-testid="patterns-overflow-dropdown">
                  <MenuItem
                    onClick={handleCopyCsv}
                    disabled={filteredLatest.length === 0}
                    data-testid="patterns-copy-csv"
                  >
                    Copy CSV
                  </MenuItem>
                  <MenuItem
                    onClick={handleCopySymbols}
                    disabled={filteredLatest.length === 0}
                    data-testid="patterns-copy-symbols"
                  >
                    Copy symbols
                  </MenuItem>
                  <MenuItem
                    onClick={forceRefresh}
                    disabled={scanning || emptyCustom}
                    data-testid="patterns-force-refresh"
                  >
                    Force refresh
                  </MenuItem>
                </MenuDropdown>
              </Menu>
              {copyMsg ? (
                <Text size="xs" c={copyFailed ? "error" : "success"} data-testid="patterns-copy-toast">
                  {copyMsg}
                </Text>
              ) : null}
              {streaming && results.length > 0 ? (
                <Text size="xs" c="dimmed" data-testid="patterns-streaming">
                  {`loading more… ${results.length} of ${total}`}
                </Text>
              ) : null}
            </ToolbarRow>
          </Box>
        }
      />

      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>

        <AppliedFilters
          filters={filters}
          patterns={patterns}
          setFilter={setFilter}
          resetFilters={resetFilters}
        />

        {scanActive && filteredLatest.length > 0 ? (
          <ScanProgress
            job={job}
            scanning={scanning}
            universe={universe}
            timeframe={timeframe}
            variant="banner"
          />
        ) : null}

        {error ? (
          <Alert color="error" data-testid="patterns-error">
            {error}
          </Alert>
        ) : null}

        {view === "matrix" && matrix.error ? (
          <Alert color="error" data-testid="patterns-matrix-error">
            {matrix.error}
          </Alert>
        ) : null}

        {(view === "matrix" ? matrix.loading : loading) && !hasRows ? (
          <Box
            data-testid="patterns-loading"
            sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, py: 6 }}
          >
            {scanActive ? (
              <ScanProgress job={job} scanning={scanning} universe={universe} timeframe={timeframe} variant="block" />
            ) : (
              <>
                <Loader size="lg" />
                <Text size="sm" c="dimmed">
                  Loading results…
                </Text>
              </>
            )}
          </Box>
        ) : !hasRows ? (
          scanActive ? (
            <Box
              data-testid="patterns-empty"
              sx={{ display: "flex", flexDirection: "column", alignItems: "center", py: 6, px: 2 }}
            >
              <ScanProgress job={job} scanning={scanning} universe={universe} timeframe={timeframe} variant="block" />
            </Box>
          ) : (
            <Box
              data-testid="patterns-empty"
              sx={{
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: 1,
                bgcolor: "background.paper",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                py: 6,
                px: 2,
                textAlign: "center",
              }}
            >
              <Text size="sm" c="dimmed">
                No patterns match the current filters.
              </Text>
              <Text size="xs" c="dimmed">
                {emptyCustom
                  ? "Custom scope is empty — paste or add symbols before scanning."
                  : `No results yet for ${universe} · ${timeframe} — run a scan.`}
              </Text>
              {activeChips.length > 0 ? (
                <Box
                  data-testid="patterns-empty-relax"
                  sx={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 0.5,
                  }}
                >
                  <Text size="xs" c="dimmed">
                    Relax:
                  </Text>
                  {activeChips.slice(0, 3).map((chip) => (
                    <Chip
                      key={chip.id}
                      size="xs"
                      variant="light"
                      onClick={() => setFilter(chip.key, chip.nextValue)}
                      data-testid={`patterns-empty-relax-${chip.id}`}
                    >
                      {`${chip.group}: ${chip.label}`}
                    </Chip>
                  ))}
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={resetFilters}
                    data-testid="patterns-empty-reset"
                  >
                    Clear all
                  </Button>
                </Box>
              ) : null}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
                <Button
                  size="xs"
                  variant="filled"
                  onClick={scan}
                  disabled={scanning || emptyCustom}
                  data-testid="patterns-empty-scan"
                >
                  Scan {timeframe} now
                </Button>
                <Button size="xs" variant="outline" onClick={refresh}>
                  Refresh
                </Button>
              </Box>
            </Box>
          )
        ) : (
          <Box
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 0.25,
              minWidth: 0,
            }}
          >
            <Box sx={{ position: "relative", flex: 1, minWidth: 0 }}>
              {view === "matrix" ? (
                <PatternSymbolMatrix
                  rows={filteredMatrixRows}
                  timeframes={matrixVisibleTimeframes}
                  onSelect={openChartHit}
                  onShowMembers={changeMembers}
                  activeSymbol={fullscreen?.hit?.symbol ?? null}
                  onRowsChange={setMatrixOrder}
                  onSymbolPreview={requestSymbolPreview}
                  onSymbolPreviewEnd={endSymbolPreview}
                  onSymbolOpen={openSymbolPinned}
                />
              ) : view === "list" ? (
                <PatternListView
                  key={filters.sort}
                  hits={filteredLatest}
                  onSelect={openChartHit}
                  onShowMembers={changeMembers}
                  sort={filters.sort}
                  activeHit={fullscreen?.hit ?? null}
                  onOrderChange={setListOrder}
                  onSymbolPreview={requestSymbolPreview}
                  onSymbolPreviewEnd={endSymbolPreview}
                  onSymbolOpen={openSymbolPinned}
                />
              ) : (
                <PatternGrid
                  hits={filteredLatest}
                  onSelect={openChartHit}
                  onExpand={openFromCard}
                  onShowMembers={changeMembers}
                  trendlinesView={effectiveTrendlinesView}
                  activeHit={fullscreen?.hit ?? null}
                  onSymbolPreview={requestSymbolPreview}
                  onSymbolPreviewEnd={endSymbolPreview}
                  onSymbolOpen={openSymbolPinned}
                />
              )}
              <LoadingOverlay
                visible={view === "matrix" ? matrix.loading : loading}
                data-testid="patterns-refreshing"
              />
            </Box>
            {isDesktop && activeTab === "scan" && fullscreen && !chartMaximized ? (
              <Box
                onMouseEnter={cancelPreviewClose}
                onMouseLeave={endSymbolPreview}
                onMouseDown={pinFullscreen}
                sx={{
                  width: { lg: 460, xl: 620 },
                  flexShrink: 0,
                  position: "sticky",
                  top: 8,
                  height: "clamp(360px, calc(100vh - 200px), 980px)",
                  minHeight: 360,
                  minWidth: 0,
                }}
              >
                <PatternFullscreenView
                  {...chartViewProps}
                  opened
                  docked
                  // Replay inputs are modal-only: the dock keeps the chart and
                  // the meta column, not a 2-row datetime form.
                  onAsOfChange={undefined}
                  onLive={() => changeFullscreenAsOf(null, null)}
                  onPrev={() => stepChart(-1)}
                  onNext={() => stepChart(1)}
                  positionLabel={
                    activeIndex >= 0 ? `${activeIndex + 1} / ${dockSequence.length}` : undefined
                  }
                  onClose={closeChart}
                  onMaximize={() => setChartMaximized(true)}
                />
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
        </Tabs.Panel>
        <Tabs.Panel value="watch" data-testid="patterns-panel-watch" sx={{ py: 0 }}>
          <WatchView
            universe={universe}
            timeframe={timeframe}
            minBaseDays={filters.min_base_days}
            onOpenSymbol={openFromSymbol}
            onSymbolPreview={requestSymbolPreview}
            onSymbolPreviewEnd={endSymbolPreview}
          />
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={draftDirty ? "Filters · unsaved changes" : "Filters"}
        size="xl"
        data-testid="patterns-filter-modal"
      >
        <Box sx={{ maxHeight: "78vh", overflowY: "auto", pr: 1 }}>
          <PatternFilterRail
            layout="panel"
            patterns={patterns}
            results={filteredLatest}
            summary={displaySummary}
            filters={draftFilters}
            setFilter={setDraftFilter}
            resetFilters={resetDraft}
            applyFilters={applyDraftPreset}
            images={patternImages}
            onReplayScan={scanReplay}
          />
        </Box>
        <ToolbarRow
          justify="space-between"
          gap={8}
          style={{ paddingTop: 12, borderTop: "1px solid", borderColor: "var(--mui-palette-divider)" }}
        >
          <Button
            size="sm"
            variant="outline"
            onClick={resetDraft}
            data-testid="patterns-reset"
          >
            Reset all
          </Button>
          <ToolbarRow gap={8}>
            <Text size="xs" c="dimmed" data-testid="patterns-filters-hint">
              {draftDirty
                ? `${draftChipCount} filter${draftChipCount === 1 ? "" : "s"} staged · ⌘/Ctrl+Enter`
                : `${filteredLatest.length} result${filteredLatest.length === 1 ? "" : "s"} shown`}
            </Text>
            <Button
              size="sm"
              variant="outline"
              onClick={cancelDraft}
              data-testid="patterns-filters-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="filled"
              onClick={applyDraft}
              data-testid="patterns-filters-done"
            >
              {draftDirty ? "Apply filters" : "Done"}
            </Button>
          </ToolbarRow>
        </ToolbarRow>
      </Modal>

      <IndexMembersDrawer
        open={members != null}
        indexId={members}
        onClose={() => changeMembers(null)}
        onScanMembers={selectSymbols}
      />

      <PatternFullscreenView
        {...chartViewProps}
        opened={!!fullscreen && (!isDesktop || chartMaximized || activeTab !== "scan")}
        // Maximize is a promotion, not a reset: closing returns to the dock.
        onClose={isDesktop && chartMaximized && activeTab === "scan" ? () => setChartMaximized(false) : closeChart}
        onPrev={() => stepChart(-1)}
        onNext={() => stepChart(1)}
        positionLabel={
          activeIndex >= 0 ? `${activeIndex + 1} / ${dockSequence.length}` : undefined
        }
      />
    </Box>
  );
}
