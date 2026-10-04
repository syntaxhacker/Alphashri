import { useRef, useState } from "react";
import { Alert, Box, Button, Loader, LoadingOverlay, Modal, Text, ToolbarRow } from "@/ui";
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
  Universe,
} from "@/types/chartPatterns";
import { fetchSymbolChart } from "@/api/chartPatterns";
import { UniverseBar } from "@/components/patterns/UniverseBar";
import { ScanStats } from "@/components/patterns/ScanStats";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import { TimeframeSelect } from "@/components/patterns/TimeframeSelect";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { ResultsSearch } from "@/components/patterns/ResultsSearch";
import { PatternGrid } from "@/components/patterns/PatternGrid";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";

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
  return n;
}

export interface PatternsPageProps {
  timeframes: TFSpec[];
  universes: Universe[];
  patterns: PatternDef[];
  timeframe: string;
  setTimeframe: (value: string) => void;
  universe: string;
  setUniverse: (value: string) => void;
  filters: PatternFilters;
  setFilter: (key: string, value: any) => void;
  resetFilters: () => void;
  applyFilters: (filters: Partial<PatternFilters>) => void;
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
  universe,
  setUniverse,
  filters,
  setFilter,
  resetFilters,
  applyFilters,
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
}: PatternsPageProps) {
  const [fullscreen, setFullscreen] = useState<{
    hit: PatternHitDTO;
    candles: ChartCandle[];
    overlays: PatternOverlay[];
  } | null>(null);
  // Monotonic request token: clicking two cards of the same symbol in quick
  // succession must not let the stale fetch overwrite the newer selection.
  const chartRequestRef = useRef(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = activeFilterCount(filters);

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
    setFullscreen({ hit, candles: hit.candles ?? [], overlays: [] });
    void fetchSymbolChart(hit.symbol, hit.timeframe)
      .then((chart) => {
        // Drop stale responses: only the latest request may update the view.
        if (chartRequestRef.current !== token) return;
        setFullscreen((prev) =>
          prev && hitIdentity(prev.hit) === identity
            ? {
                ...prev,
                candles: chart.candles?.length ? chart.candles : prev.candles,
                overlays: chart.overlays ?? [],
              }
            : prev,
        );
      })
      .catch(() => {
        /* non-fatal: keep the card's pattern + candles */
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
      <Box sx={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 1.5, minWidth: 0 }}>
        <UniverseBar
          universes={universes}
          universe={universe}
          setUniverse={setUniverse}
          scan={scan}
          scanning={scanning}
          job={job}
          queuePosition={queuePosition}
          error={error}
        />
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
            <SymbolFilter filters={filters} setFilter={setFilter} />
            <ResultsSearch filters={filters} setFilter={setFilter} />
            <Button
              size="xs"
              variant="filled"
              leftSection={<IconAdjustmentsHorizontal size={14} />}
              onClick={() => setFiltersOpen(true)}
              data-testid="patterns-open-filters"
            >
              Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            </Button>
          </ToolbarRow>
        </ToolbarRow>

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
            <Loader size="lg" />
            <Text size="sm" c="dimmed">
              Detecting chart patterns…
            </Text>
          </Box>
        ) : results.length === 0 ? (
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
        ) : (
          // Keep the grid mounted while a refresh loads: the overlay spinner
          // signals progress without remounting every mini-chart.
          <Box sx={{ position: "relative", minWidth: 0 }}>
            <PatternGrid hits={results} onSelect={openFromCard} onExpand={openFromCard} />
            <LoadingOverlay visible={loading} data-testid="patterns-refreshing" />
          </Box>
        )}
      </Box>

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
            filters={filters}
            setFilter={setFilter}
            resetFilters={resetFilters}
            applyFilters={applyFilters}
          />
        </Box>
        <ToolbarRow justify="flex-end" gap={8} style={{ paddingTop: 16 }}>
          <Button
            size="sm"
            variant="filled"
            onClick={() => setFiltersOpen(false)}
            data-testid="patterns-filters-done"
          >
            Done
          </Button>
        </ToolbarRow>
      </Modal>

      <PatternFullscreenView
        opened={!!fullscreen}
        onClose={() => setFullscreen(null)}
        hit={fullscreen?.hit ?? null}
        candles={fullscreen?.candles ?? []}
        overlays={fullscreen?.overlays ?? []}
      />
    </Box>
  );
}
