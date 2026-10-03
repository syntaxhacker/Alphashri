import { useState } from "react";
import { Box, Button, Loader, Text, ToolbarRow } from "@/ui";
import type {
  ChartCandle,
  JobDTO,
  PatternDef,
  PatternFilters,
  PatternHitDTO,
  PatternSummary,
  TFSpec,
  Universe,
} from "@/types/chartPatterns";
import { UniverseBar } from "@/components/patterns/UniverseBar";
import { ScanStats } from "@/components/patterns/ScanStats";
import { PatternFilterRail } from "@/components/patterns/PatternFilterRail";
import { SymbolFilter } from "@/components/patterns/SymbolFilter";
import { ResultsSearch } from "@/components/patterns/ResultsSearch";
import { PatternGrid } from "@/components/patterns/PatternGrid";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";

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
  const [fullscreen, setFullscreen] = useState<{ hit: PatternHitDTO; candles: ChartCandle[] } | null>(null);
  const openFromCard = (hit: PatternHitDTO) => setFullscreen({ hit, candles: hit.candles ?? [] });

  return (
    <Box
      data-testid="patterns-page"
      sx={{
        p: 2,
        display: "grid",
        gap: 2,
        alignItems: "start",
        width: "100%",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          md: "260px minmax(0, 1fr)",
          lg: "260px minmax(0, 1fr)",
        },
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

      <Box
        sx={{
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
          p: 1.5,
          minWidth: 0,
        }}
      >
        <PatternFilterRail
          patterns={patterns}
          results={results}
          summary={summary}
          filters={filters}
          setFilter={setFilter}
          resetFilters={resetFilters}
          applyFilters={applyFilters}
          timeframes={timeframes}
          timeframe={timeframe}
          setTimeframe={setTimeframe}
        />
      </Box>

      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <ToolbarRow
          justify="space-between"
          data-testid="patterns-results-toolbar"
          style={{ rowGap: 8 }}
        >
          <Text size="xs" c="dimmed" fw={700} style={{ textTransform: "uppercase" }}>
            {total > 0 ? `${total} patterns` : "Patterns"}
          </Text>
          <ToolbarRow gap={8} justify="flex-end">
            <SymbolFilter filters={filters} setFilter={setFilter} />
            <ResultsSearch filters={filters} setFilter={setFilter} />
          </ToolbarRow>
        </ToolbarRow>

        {loading ? (
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
          <PatternGrid hits={results} onSelect={openFromCard} onExpand={openFromCard} />
        )}
      </Box>

      <PatternFullscreenView
        opened={!!fullscreen}
        onClose={() => setFullscreen(null)}
        hit={fullscreen?.hit ?? null}
        candles={fullscreen?.candles ?? []}
      />
    </Box>
  );
}
