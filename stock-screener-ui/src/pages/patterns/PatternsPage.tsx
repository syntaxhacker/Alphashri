import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Loader, LoadingOverlay, Modal, Switch, Tabs, Text, ToolbarRow, Tooltip } from "@/ui";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import type {
  ChartCandle,
  JobDTO,
  PatternDef,
  PatternFilters,
  PatternHitDTO,
  PatternOverlay,
  PatternSummary,
  TFSpec,
  TrendLine,
  Universe,
} from "@/types/chartPatterns";
import { fetchSymbolChart } from "@/api/chartPatterns";
import { fetchPatternImages } from "@/api/patternImages";
import { UniverseBar } from "@/components/patterns/UniverseBar";
import { ScanStats } from "@/components/patterns/ScanStats";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import { TimeframeSelect } from "@/components/patterns/TimeframeSelect";
import { LookbackSelect } from "@/components/patterns/LookbackSelect";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { ResultsSearch } from "@/components/patterns/ResultsSearch";
import { PatternGrid } from "@/components/patterns/PatternGrid";
import { ScanProgress, ReusedScanNotice } from "@/components/patterns/ScanProgress";
import { AppliedFilters } from "@/components/patterns/AppliedFilters";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import { ReplayScanControl, type ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import { WatchView } from "@/components/patterns/WatchView";
import { formatAsOfLabel } from "@/components/patterns/datetime";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";

/** Count of active (non-default) filters, shown on the Filters button. */
function activeFilterCount(f: PatternFilters): number {
  let n = 0;
  if (f.family?.length) n += 1;
  if (f.pattern_id?.length) n += 1;
  if (f.direction?.length) n += 1;
  if (f.status?.length) n += 1;
  if (f.quality) n += 1;
  if (f.formed_within_bars != null) n += 1;
  if (f.volume_confirmed != null) n += 1;
  if (f.min_rr != null) n += 1;
  if (f.symbol) n += 1;
  if (f.symbols?.length) n += 1;
  if (f.q) n += 1;
  if (f.min_base_days != null) n += 1;
  if (f.max_range_pct != null) n += 1;
  if (f.max_52w_gap != null) n += 1;
  if (f.min_range_pos != null) n += 1;
  if (f.from_date) n += 1;
  if (f.to_date) n += 1;
  if (f.min_rel_volume != null) n += 1;
  if (f.min_volume_m != null) n += 1;
  if (f.trendlines && f.trendlines !== "both") n += 1;
  return n;
}

export interface PatternsPageProps {
  timeframes: TFSpec[];
  universes: Universe[];
  patterns: PatternDef[];
  timeframe: string;
  setTimeframe: (value: string) => void;
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
  loading,
  error,
  scan,
  refresh,
  forceRefresh,
  scanReplay,
  replayAsOf = null,
  tab: tabProp,
  setTab: setTabProp,
}: PatternsPageProps) {
  const [fullscreen, setFullscreen] = useState<{
    symbol: string;
    hit: PatternHitDTO | null;
    /** Fullscreen timeframe (defaults to the opened hit's timeframe). */
    timeframe: string;
    candles: ChartCandle[];
    overlays: PatternOverlay[];
    trendLines: TrendLine[];
    /** True while a fullscreen timeframe switch is reloading the chart. */
    loading: boolean;
    /** As-of replay cutoff (ISO local datetime, null = live). */
    asOf: string | null;
    /** Replay window start (ISO local datetime, null = any). */
    fromDate: string | null;
  } | null>(null);
  // Monotonic request token: clicking two cards of the same symbol in quick
  // succession must not let the stale fetch overwrite the newer selection.
  const chartRequestRef = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Workspace tab: controlled by the container (URL sync) when provided,
  // otherwise local state defaulting to the scan view.
  const [internalTab, setInternalTab] = useState<"scan" | "watch">("scan");
  const activeTab = tabProp ?? internalTab;
  const handleTabChange = (value: string | null) => {
    if (value !== "scan" && value !== "watch") return;
    if (setTabProp) setTabProp(value);
    else setInternalTab(value);
  };
  // Filter edits are staged in a draft and only applied when the user clicks
  // "Filter" — changing a control no longer triggers an instant reload.
  const [draftFilters, setDraftFilters] = useState<PatternFilters>(filters);
  useEffect(() => {
    if (filtersOpen) setDraftFilters(filters);
  }, [filtersOpen]);
  const setDraftFilter = (key: string, value: unknown): void => {
    setDraftFilters((prev) => ({ ...prev, [key]: value }) as PatternFilters);
  };
  const resetDraft = (): void => setDraftFilters(DEFAULT_PATTERN_FILTERS);
  const applyDraftPreset = (patch: Partial<PatternFilters>): void => {
    setDraftFilters((prev) => ({ ...prev, ...patch }));
  };
  const applyDraft = (): void => {
    applyFilters(draftFilters);
    setFiltersOpen(false);
  };
  const [patternImages, setPatternImages] = useState<Record<string, string>>({});
  const activeFilters = activeFilterCount(filters);
  const scanActive = scanning || job?.status === "running" || job?.status === "queued";

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

  /** Full hit identity — distinguishes two instances on the same symbol/timeframe. */
  // Top-level compute toggle off: draw no standalone trendlines anywhere,
  // regardless of the view-only `trendlines` filter.
  const effectiveTrendlinesView = computeTrendlines ? (filters.trendlines ?? "both") : "none";

  /** Full hit identity — distinguishes two instances on the same symbol/timeframe. */
  const hitIdentity = (hit: PatternHitDTO): string =>
    `${hit.id ?? `${hit.symbol}|${hit.timeframe}|${hit.pattern_id}|${hit.start_date}`}`;

  // On open, load every detected pattern for the symbol so the fullscreen can
  // draw the whole sequence (the clicked one solid, siblings dashed) rather than
  // a single structure. Falls back to the card's own candles if the fetch fails.
  const openFromCard = (hit: PatternHitDTO) => {
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const identity = hitIdentity(hit);
    setFullscreen({
      symbol: hit.symbol,
      hit,
      timeframe: hit.timeframe,
      candles: hit.candles ?? [],
      overlays: [],
      trendLines: hit.trend_lines ?? [],
      loading: false,
      asOf: null,
      fromDate: null,
    });
    // Forward the TLS/TLR opt-out: with computation off the chart endpoint
    // skips the detector and returns empty `trend_lines`.
    void fetchSymbolChart(hit.symbol, hit.timeframe, {
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    })
      .then((chart) => {
        // Drop stale responses: only the latest request may update the view.
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.hit && hitIdentity(prev.hit) === identity
            ? {
                ...prev,
                candles: chart.candles?.length ? chart.candles : prev.candles,
                overlays: chart.overlays ?? [],
                trendLines: chart.trend_lines ?? prev.trendLines,
              }
            : prev,
        );
      })
      .catch(() => {
        /* non-fatal: keep the card's pattern + candles */
      });
  };

  /**
   * Watch-row open: fetch the symbol chart with live pattern detection and
   * show it fullscreen, promoting the highest-confidence hit (or null when
   * there is none). Mirrors `openFromCard` without needing a card hit.
   */
  const openFromSymbol = (symbol: string) => {
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    setFullscreen({
      symbol,
      hit: null,
      timeframe,
      candles: [],
      overlays: [],
      trendLines: [],
      loading: true,
      asOf: null,
      fromDate: null,
    });
    void fetchSymbolChart(symbol, timeframe, {
      detectPatterns: true,
      ...(lookbackBars != null ? { lookbackBars } : {}),
      computeTrendlines,
    })
      .then((chart) => {
        if (chartRequestRef.current !== token) return;
        const hits = chart.hits ?? [];
        let best: PatternHitDTO | null = null;
        for (const candidate of hits) {
          if (!best || candidate.confidence > best.confidence) best = candidate;
        }
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === timeframe
            ? {
                ...prev,
                hit: best,
                candles: chart.candles ?? [],
                overlays: chart.overlays ?? [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === timeframe
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  /**
   * Fullscreen timeframe switch: re-runs pattern detection on the new
   * timeframe (`detect_patterns=1`), swaps candles/overlays/trendlines, and
   * promotes the highest-confidence hit (or null when there is none).
   * Preserves the active as-of replay window when one is set.
   */
  const changeFullscreenTimeframe = (tf: string) => {
    const current = fullscreen;
    if (!current || tf === current.timeframe) return;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const { symbol, asOf, fromDate } = current;
    setFullscreen({ ...current, timeframe: tf, loading: true });
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      ...(asOf ? { asOf } : {}),
      ...(fromDate ? { fromDate } : {}),
    })
      .then((chart) => {
        // Drop stale responses: only the latest request may update the view.
        if (chartRequestRef.current !== token) return;
        const hits = chart.hits ?? [];
        let best: PatternHitDTO | null = null;
        for (const candidate of hits) {
          if (!best || candidate.confidence > best.confidence) best = candidate;
        }
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? {
                ...prev,
                hit: best,
                candles: chart.candles ?? [],
                overlays: chart.overlays ?? [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        // Non-fatal: keep the previous chart, just clear the spinner.
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? { ...prev, loading: false }
            : prev,
        );
      });
  };

  /**
   * Fullscreen as-of replay: re-runs detection truncated at the cutoff
   * (`detect_patterns=1` + `asOf`/`fromDate`), swaps candles, and promotes
   * the highest-confidence hit in the window (or null when there is none).
   * Keeps the loading state while the replay fetch is in flight.
   */
  const changeFullscreenAsOf = (asOf: string | null, fromDate: string | null) => {
    const current = fullscreen;
    if (!current) return;
    const token = chartRequestRef.current + 1;
    chartRequestRef.current = token;
    const { symbol, timeframe: tf } = current;
    setFullscreen({ ...current, asOf, fromDate, loading: true });
    void fetchSymbolChart(symbol, tf, {
      detectPatterns: true,
      asOf: asOf ?? undefined,
      fromDate: fromDate ?? undefined,
    })
      .then((chart) => {
        // Drop stale responses: only the latest request may update the view.
        if (chartRequestRef.current !== token) return;
        const hits = chart.hits ?? [];
        let best: PatternHitDTO | null = null;
        for (const candidate of hits) {
          if (!best || candidate.confidence > best.confidence) best = candidate;
        }
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? {
                ...prev,
                asOf,
                fromDate,
                hit: best,
                candles: chart.candles ?? [],
                overlays: chart.overlays ?? [],
                trendLines: chart.trend_lines ?? [],
                loading: false,
              }
            : prev,
        );
      })
      .catch(() => {
        // Non-fatal: keep the previous chart, just clear the spinner.
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && prev.symbol === symbol && prev.timeframe === tf
            ? { ...prev, asOf, fromDate, loading: false }
            : prev,
        );
      });
  };

  return (
    <Box
      data-testid="patterns-page"
      sx={{
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        width: "100%",
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
        <Tabs.Panel value="scan" data-testid="patterns-panel-scan">
      <Box sx={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 1.5, minWidth: 0 }}>
        <UniverseBar
          universes={universes}
          universe={universe}
          setUniverse={setUniverse}
          customUniverse={customUniverse}
          customSymbolCount={filters.symbols?.length ?? 0}
          scan={scan}
          scanning={scanning}
          job={job}
          queuePosition={queuePosition}
          error={error}
        />
        <Box
          data-testid="patterns-scan-scope"
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, bgcolor: "background.paper", p: 1 }}
        >
          <SymbolFilter
            filters={filters}
            setFilter={setFilter}
            onChange={selectSymbols}
            placeholder="Search symbols to scan…"
            helperText="Add symbols to scan just those — skips the whole universe"
          />
          <Box sx={{ mt: 1 }}>
            <ReplayScanControl onReplayScan={scanReplay} />
          </Box>
          {replayAsOf ? (
            <Text size="xs" c="dimmed" data-testid="patterns-scan-asof">
              {`as of ${formatAsOfLabel(replayAsOf)}`}
            </Text>
          ) : null}
        </Box>
        <ScanStats summary={summary} />
      </Box>

      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <ToolbarRow
          justify="space-between"
          data-testid="patterns-results-toolbar"
          style={{ rowGap: 8, flexWrap: "wrap" }}
        >
          <Text size="xs" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
            {total > 0 ? `${total} patterns` : "Patterns"}
          </Text>
          <ToolbarRow gap={8} justify="flex-end" align="center" style={{ flexWrap: "wrap" }}>
            <TimeframeSelect timeframes={timeframes} value={timeframe} onChange={setTimeframe} />
            <LookbackSelect value={lookbackBars} onChange={setLookbackBars} />
            <ResultsSearch filters={filters} setFilter={setFilter} />
            <Switch
              label="TLS/TLR"
              size="sm"
              checked={computeTrendlines}
              onChange={(e) => setComputeTrendlines(e.target.checked)}
              data-testid="patterns-compute-trendlines"
            />
            <Button
              size="xs"
              variant="filled"
              leftSection={<IconAdjustmentsHorizontal size={14} />}
              onClick={() => setFiltersOpen(true)}
              data-testid="patterns-open-filters"
            >
              Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Button>
            <Tooltip label={job?.reused ? "Re-scan fresh (last scan was reused)" : "Clear cached candles and re-scan fresh"}>
              <Button
                size="xs"
                variant={job?.reused ? "filled" : "outline"}
                onClick={forceRefresh}
                disabled={scanning}
                data-testid="patterns-force-refresh"
              >
                Force refresh
              </Button>
            </Tooltip>
            {job?.reused && !scanActive ? <ReusedScanNotice job={job} /> : null}
          </ToolbarRow>
        </ToolbarRow>

        <AppliedFilters
          filters={filters}
          patterns={patterns}
          setFilter={setFilter}
          resetFilters={resetFilters}
        />

        {scanActive && results.length > 0 ? (
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

        {loading && results.length === 0 ? (
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
        ) : results.length === 0 ? (
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
                No results yet for {universe} · {timeframe} — run a scan.
              </Text>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
                <Button
                  size="xs"
                  variant="filled"
                  onClick={scan}
                  disabled={scanning}
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
          // Keep the grid mounted while a refresh loads: the overlay spinner
          // signals progress without remounting every mini-chart.
          <Box sx={{ position: "relative", minWidth: 0 }}>
            <PatternGrid hits={results} onSelect={openFromCard} onExpand={openFromCard} trendlinesView={effectiveTrendlinesView} />
            <LoadingOverlay visible={loading} data-testid="patterns-refreshing" />
          </Box>
        )}
      </Box>
        </Tabs.Panel>
        <Tabs.Panel value="watch" data-testid="patterns-panel-watch">
          <WatchView
            universe={universe}
            timeframe={timeframe}
            minBaseDays={filters.min_base_days}
            onOpenSymbol={openFromSymbol}
          />
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        size="xl"
        data-testid="patterns-filter-modal"
      >
        <Box sx={{ maxHeight: "68vh", overflowY: "auto", pr: 1 }}>
          <PatternFilterRail
            layout="panel"
            patterns={patterns}
            results={results}
            summary={summary}
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
          <Button
            size="sm"
            variant="filled"
            onClick={applyDraft}
            data-testid="patterns-filters-done"
          >
            Filter
          </Button>
        </ToolbarRow>
      </Modal>

      <PatternFullscreenView
        opened={!!fullscreen}
        onClose={() => setFullscreen(null)}
        hit={fullscreen?.hit ?? null}
        candles={fullscreen?.candles ?? []}
        overlays={fullscreen?.overlays ?? []}
        trendLines={fullscreen?.trendLines ?? []}
        trendlinesView={effectiveTrendlinesView}
        timeframe={fullscreen?.timeframe}
        timeframes={timeframes}
        onTimeframeChange={changeFullscreenTimeframe}
        loading={fullscreen?.loading ?? false}
        asOf={fullscreen?.asOf ?? null}
        fromDate={fullscreen?.fromDate ?? null}
        onAsOfChange={changeFullscreenAsOf}
      />
    </Box>
  );
}
