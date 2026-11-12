import { createSignal, createMemo, onMount, Show } from "solid-js";
import { Box, Text, Select, TextInput, LoadingOverlay, Badge, ToolbarRow } from "@/ui";
import { fetchHeatmapData, fetchHeatmapSectors, type HeatmapResponse, type HeatmapStock, type SectorInfo } from "../../api/heatmap";
import { METRICS, getMetricValue, getMetricColor, getMetricTextColor } from "./heatmapUtils";
import { HeatmapTreemap } from "./HeatmapTreemap";
import { ScatterView } from "./ScatterView";
import { DistributionView } from "./DistributionView";
import { SectorBarView } from "./SectorBarView";
import { SECTOR_STRONG_GREEN, SECTOR_GREEN, SECTOR_NEUTRAL, SECTOR_RED, SECTOR_STRONG_RED } from "../../config/colors";

import { TopBottomView } from "./TopBottomView";
import { HeatmapListView } from "./HeatmapListView";

const VIEWS = [
  { value: "treemap", label: "Treemap" },
  { value: "list", label: "List" },
  { value: "scatter", label: "Scatter" },
  { value: "distribution", label: "Distribution" },
  { value: "sectors", label: "Sectors" },
  { value: "top10", label: "Top 10" },
];

export function HeatmapPage() {
  const [view, setView] = createSignal("treemap");
  const [sectorFilter, setSectorFilter] = createSignal<string | null>(null);
  const [searchFilter, setSearchFilter] = createSignal("");
  const [metric, setMetric] = createSignal<string>("market_cap");
  const [sortDir, setSortDir] = createSignal<"desc" | "asc">("desc");
  const [scatterMetricX, setScatterMetricX] = createSignal<string>("pe_ratio");
  const [scatterMetricY, setScatterMetricY] = createSignal<string>("roe");

  const [heatmapData, setHeatmapData] = createSignal<HeatmapResponse | null>(null);
  const [heatmapLoading, setHeatmapLoading] = createSignal(true);
  const [heatmapError, setHeatmapError] = createSignal<string | null>(null);
  const [sectorsData, setSectorsData] = createSignal<{ sectors: SectorInfo[] } | null>(null);

  onMount(() => {
    fetchHeatmapData(undefined, undefined, undefined, 500)
      .then((d) => setHeatmapData(d))
      .catch((err) => setHeatmapError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setHeatmapLoading(false));
    fetchHeatmapSectors()
      .then((d) => setSectorsData(d))
      .catch(() => {
        // Sector filter is best-effort: the page still works without it.
      });
  });

  const filteredStocks = createMemo<HeatmapStock[]>(() => {
    const stocks = heatmapData()?.stocks ?? [];
    let filtered = stocks;
    if (sectorFilter()) {
      const sector = sectorFilter();
      filtered = filtered.filter((s) => s.sector === sector);
    }
    if (searchFilter()) {
      const lower = searchFilter().toLowerCase();
      filtered = filtered.filter(
        (s) => s.symbol.toLowerCase().includes(lower) || s.name.toLowerCase().includes(lower),
      );
    }
    const dir = sortDir();
    return [...filtered].sort((a, b) => {
      const va = getMetricValue(a, metric());
      const vb = getMetricValue(b, metric());
      return dir === "desc" ? vb - va : va - vb;
    });
  });

  const activeMetric = createMemo(() => METRICS.find((m) => m.value === metric()) || METRICS[0]);

  const metricMin = createMemo(() => {
    const values = filteredStocks().map((s) => getMetricValue(s, metric()));
    return values.length ? Math.min(...values) : 0;
  });
  const metricMax = createMemo(() => {
    const values = filteredStocks().map((s) => getMetricValue(s, metric()));
    return values.length ? Math.max(...values) : 1;
  });

  const sectorOptions = createMemo(() => {
    const sectors = sectorsData()?.sectors;
    if (!sectors) return [];
    return sectors.map((s: SectorInfo) => ({
      value: s.name,
      label: `${s.name} (${s.count})`,
    }));
  });

  const metricOptions = METRICS.map((m) => ({ value: m.value, label: m.label }));

  const isTableView = () => view() === "list" || view() === "top10";
  const isChartView = () => view() === "treemap";
  const isScatterView = () => view() === "scatter";
  const isDistView = () => view() === "distribution";
  const isSectorView = () => view() === "sectors";
  const isTop10View = () => view() === "top10";

  return (
    <Box
      data-testid="heatmap-page"
      className="flex h-full w-full min-h-0 flex-col overflow-hidden"
    >
      <ToolbarRow
        gap={8}
        style={{ padding: "0 16px", "min-height": 48, height: 48, "border-bottom": "1px solid var(--color-fin-border)", "flex-shrink": 0 }}
        data-testid="heatmap-toolbar"
      >
        <Text data-testid="heatmap-title" fw={700} size="sm">NSE 500</Text>
        <Badge data-testid="heatmap-badge" variant="light" color={heatmapData()?.cached ? "success" : "primary"}>
          {heatmapData()?.cached ? "Cached" : "Live"}
        </Badge>
        <Select
          data-testid="heatmap-sector-filter"
          size="xs"
          w={180}
          placeholder="Filter by sector"
          clearable
          value={sectorFilter()}
          onChange={setSectorFilter}
          data={sectorOptions()}
          searchable
          aria-label="Sector filter"
        />
        <TextInput
          data-testid="heatmap-search"
          size="xs"
          w={140}
          placeholder="Search symbol..."
          value={searchFilter()}
          onChange={(val) => setSearchFilter(val)}
          aria-label="Search symbol"
        />
        <Show when={!isScatterView()}>
          <Select
            data-testid="heatmap-metric"
            size="xs"
            w={130}
            label="Metric"
            value={metric()}
            onChange={(v) => setMetric(v || "market_cap")}
            data={metricOptions}
            aria-label="Metric"
          />
        </Show>
        <Select
          data-testid="heatmap-view"
          size="xs"
          w={130}
          label="View"
          value={view()}
          onChange={(v) => setView(v || "treemap")}
          data={VIEWS}
          aria-label="View"
        />
        <Box className="flex-1" />
        <Text
          data-testid="heatmap-stock-count"
          size="xs"
          c="dimmed"
          className="cursor-pointer whitespace-nowrap"
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          title="Toggle sort direction"
        >
          {filteredStocks().length} stocks {sortDir() === "desc" ? "↓" : "↑"}
        </Text>
      </ToolbarRow>

      <Box className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LoadingOverlay visible={heatmapLoading()} />
        <Show when={heatmapError()}>
          <Box className="flex h-[200px] w-full items-center justify-center">
            <Text data-testid="heatmap-error" c="error">Error: {heatmapError()}</Text>
          </Box>
        </Show>
        <Show when={!heatmapLoading() && !heatmapError() && filteredStocks().length === 0}>
          <Box className="flex h-[200px] w-full items-center justify-center">
            <Text size="sm" c="dimmed">No stocks match the current filters.</Text>
          </Box>
        </Show>
        <Show when={!heatmapLoading() && isChartView() && filteredStocks().length > 0}>
          <HeatmapTreemap
            stocks={filteredStocks()}
            metric={metric()}
            showLegend={false}
            testId="heatmap-page-treemap"
          />
        </Show>
        <Show when={isTableView()}>
          <HeatmapListView
            stocks={filteredStocks()}
            metric={metric()}
            activeMetric={activeMetric()}
            metricMin={metricMin()}
            metricMax={metricMax()}
          />
        </Show>
        <Show when={!heatmapLoading() && isScatterView()}>
          <ScatterView
            stocks={filteredStocks()}
            metricX={scatterMetricX()}
            metricY={scatterMetricY()}
            onMetricXChange={setScatterMetricX}
            onMetricYChange={setScatterMetricY}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        </Show>
        <Show when={!heatmapLoading() && isDistView()}>
          <DistributionView
            stocks={filteredStocks()}
            metric={metric()}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        </Show>
        <Show when={!heatmapLoading() && isSectorView()}>
          <SectorBarView
            stocks={filteredStocks()}
            metric={metric()}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        </Show>
        <Show when={!heatmapLoading() && isTop10View()}>
          <TopBottomView
            stocks={filteredStocks()}
            metric={metric()}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            getMetricTextColor={getMetricTextColor}
            METRICS={METRICS}
          />
        </Show>
      </Box>

      <Box
        data-testid="heatmap-legend"
        className="flex h-8 min-h-8 flex-shrink-0 items-center gap-4 overflow-hidden border-t border-fin-border px-4"
      >
        <Text size="xs" fw={600} data-testid="heatmap-legend-label">{activeMetric().label}</Text>
        <Box className="h-3 w-3 flex-shrink-0 rounded-[2px]" style={{ "background-color": getMetricColor(metricMin(), metricMin(), metricMax()) }} />
        <Text size="xs" data-testid="heatmap-legend-min">{activeMetric().fmt(metricMin())}</Text>
        <Box className="h-2 max-w-[120px] flex-1 rounded-[4px]" style={{ background: `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
        <Box className="h-3 w-3 flex-shrink-0 rounded-[2px]" style={{ "background-color": getMetricColor(metricMax(), metricMin(), metricMax()) }} />
        <Text size="xs" data-testid="heatmap-legend-max">{activeMetric().fmt(metricMax())}</Text>
      </Box>
    </Box>
  );
}
