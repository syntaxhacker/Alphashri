import { useEffect, useRef, useState } from "react";
import { ActionIcon, Alert, Box, Button, Loader, LoadingOverlay, Menu, MenuDropdown, MenuItem, MenuTarget, Modal, SegmentedControl, Switch, Tabs, Text, ToolbarRow } from "@/ui";
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
import { ScanProgress, ScanCacheChip } from "@/components/patterns/ScanProgress";
import { AppliedFilters } from "@/components/patterns/AppliedFilters";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import { usePatternFullscreen } from "@/hooks/usePatternFullscreen";
import { ReplayScanControl, type ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import { WatchView } from "@/components/patterns/WatchView";
import { formatAsOfLabel } from "@/components/patterns/datetime";
import { DEFAULT_PATTERN_FILTERS } from "@/state/chartPatterns";
import { copyToClipboard, toCsv, toSymbolList, type CsvColumn } from "@/utils/copyCsv";

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
  if (f.min_confidence != null) n += 1;
  if (f.min_breakout_score != null) n += 1;
  if (f.from_date) n += 1;
  if (f.to_date) n += 1;
  if (f.min_rel_volume != null) n += 1;
  if (f.min_volume_m != null) n += 1;
  // The default-on 10d-avg-volume floor is a system default, not an active
  // (user-applied) filter, so it must not inflate the badge count.
  if (
    f.min_avg_volume_10d != null &&
    f.min_avg_volume_10d !== DEFAULT_PATTERN_FILTERS.min_avg_volume_10d
  )
    n += 1;
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
    changeFullscreenTimeframe,
    changeFullscreenAsOf,
    selectFullscreenHit,
    closeFullscreen,
  } = usePatternFullscreen({ timeframe, lookbackBars, computeTrendlines });
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Dense results view: `list` (default) or the card `grid`. */
  const [view, setView] = useState<"list" | "grid">("list");
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
  // Copy-to-clipboard feedback for the results export.
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );
  const flashCopy = (message: string, failed: boolean): void => {
    setCopyMsg(message);
    setCopyFailed(failed);
    if (copyTimerRef.current != null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyMsg(null);
      setCopyFailed(false);
      copyTimerRef.current = null;
    }, 3000);
  };
  const handleCopyCsv = (): void => {
    const csv = toCsv(results as unknown as Array<Record<string, unknown>>, PATTERNS_CSV_COLUMNS);
    void copyToClipboard(csv).then((ok) =>
      flashCopy(ok ? `Copied ${results.length} row${results.length === 1 ? "" : "s"}` : "Copy failed", !ok),
    );
  };
  const handleCopySymbols = (): void => {
    const list = toSymbolList(results as unknown as Array<Record<string, unknown>>);
    void copyToClipboard(list).then((ok) =>
      flashCopy(
        ok ? `Copied ${results.length} symbol${results.length === 1 ? "" : "s"}` : "Copy failed",
        !ok,
      ),
    );
  };

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


  return (
    <Box
      data-testid="patterns-page"
      sx={{
        px: 2,
        py: 1,
        display: "flex",
        flexDirection: "column",
        gap: 1,
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
        <Tabs.Panel value="scan" data-testid="patterns-panel-scan">
      <Box sx={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <ToolbarRow
          data-testid="patterns-scan-scope"
          gap={8}
          justify="space-between"
          style={{ minHeight: 32, flexWrap: "wrap", rowGap: 2 }}
        >
          <span title="Add symbols to scan just those — skips the whole universe">
            <SymbolFilter
              filters={filters}
              setFilter={setFilter}
              onChange={selectSymbols}
              placeholder="Search symbols to scan…"
              helperText=""
            />
          </span>
          <ReplayScanControl onReplayScan={scanReplay} />
          {replayAsOf ? (
            <Text size="xs" c="dimmed" data-testid="patterns-scan-asof">
              {`as of ${formatAsOfLabel(replayAsOf)}`}
            </Text>
          ) : null}
        </ToolbarRow>
        <ScanStats summary={summary} />
      </Box>
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
        actions={
          <ToolbarRow
            justify="flex-start"
            align="center"
            gap={8}
            wrap={true}
            data-testid="patterns-results-toolbar"
          >
            {streaming && results.length > 0 ? (
              <Text size="xs" c="dimmed" data-testid="patterns-streaming">
                {`loading more… ${results.length} of ${total}`}
              </Text>
            ) : null}
            <SegmentedControl
              data={[
                { value: "list", label: "List" },
                { value: "grid", label: "Grid" },
              ]}
              value={view}
              onChange={(v) => {
                if (v === "list" || v === "grid") setView(v);
              }}
              size="xs"
              data-testid="patterns-view-toggle"
            />
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
                  disabled={results.length === 0}
                  data-testid="patterns-copy-csv"
                >
                  Copy CSV
                </MenuItem>
                <MenuItem
                  onClick={handleCopySymbols}
                  disabled={results.length === 0}
                  data-testid="patterns-copy-symbols"
                >
                  Copy symbols
                </MenuItem>
                <MenuItem
                  onClick={forceRefresh}
                  disabled={scanning}
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
            {job?.status === "completed" && !scanActive ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                <ScanCacheChip job={job} onForceRefresh={forceRefresh} />
                {job.data_through ? (
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ whiteSpace: "nowrap" }}
                    data-testid="patterns-scan-data-through"
                  >
                    {`as of ${job.data_through}`}
                  </Text>
                ) : null}
              </Box>
            ) : null}
          </ToolbarRow>
        }
      />

      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>

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
          // Keep the results mounted while a refresh loads: the overlay spinner
          // signals progress without remounting.
          <Box sx={{ position: "relative", minWidth: 0 }}>
            {view === "list" ? (
              <PatternListView
                key={filters.sort}
                hits={results}
                onSelect={openFromCard}
                sort={filters.sort}
              />
            ) : (
              <PatternGrid hits={results} onSelect={openFromCard} onExpand={openFromCard} trendlinesView={effectiveTrendlinesView} />
            )}
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
        onClose={closeFullscreen}
        hit={fullscreen?.hit ?? null}
        hits={fullscreen?.hits ?? []}
        onSelectHit={selectFullscreenHit}
        candles={fullscreen?.candles ?? []}
        overlays={[]}
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
