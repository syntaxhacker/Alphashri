import { useState, useMemo } from "react";
import { Box, Text, Select, TextInput, LoadingOverlay, Badge, ToolbarRow } from "@/ui";
import { useAsyncData } from "../../hooks/useAsyncData";
import { fetchHeatmapData, fetchHeatmapSectors, type SectorInfo } from "../../api/heatmap";
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
  const [view, setView] = useState("treemap");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [metric, setMetric] = useState<string>("market_cap");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [scatterMetricX, setScatterMetricX] = useState<string>("pe_ratio");
  const [scatterMetricY, setScatterMetricY] = useState<string>("roe");

  const { data: heatmapData, loading: heatmapLoading, error: heatmapError } = useAsyncData({
    fetchFn: () => fetchHeatmapData(undefined, undefined, undefined, 500),
    autoFetch: true
  });

  const { data: sectorsData } = useAsyncData({
    fetchFn: () => fetchHeatmapSectors(),
    autoFetch: true
  });

  const stocks = heatmapData?.stocks || [];

  let filtered = stocks;

  if (sectorFilter) {
    filtered = filtered.filter(s => s.sector === sectorFilter);
  }

  if (searchFilter) {
    const lower = searchFilter.toLowerCase();
    filtered = filtered.filter(
      (s) => s.symbol.toLowerCase().includes(lower) || s.name.toLowerCase().includes(lower)
    );
  }

  const activeMetric = METRICS.find((m) => m.value === metric) || METRICS[0];

  const filteredStocks = [...filtered].sort((a, b) => {
    const va = getMetricValue(a, metric);
    const vb = getMetricValue(b, metric);
    return sortDir === "desc" ? vb - va : va - vb;
  });

  const metricValues = filteredStocks.map((s) => getMetricValue(s, metric));
  const metricMin = metricValues.length ? Math.min(...metricValues) : 0;
  const metricMax = metricValues.length ? Math.max(...metricValues) : 1;

  const sectorOptions = useMemo(() => {
    if (!sectorsData?.sectors) return [];
    return sectorsData.sectors.map((s: SectorInfo) => ({
      value: s.name,
      label: `${s.name} (${s.count})`,
    }));
  }, [sectorsData]);

  const metricOptions = METRICS.map((m) => ({ value: m.value, label: m.label }));

  const isTableView = view === "list" || view === "top10";
  const isChartView = view === "treemap";
  const isScatterView = view === "scatter";
  const isDistView = view === "distribution";
  const isSectorView = view === "sectors";
  const isTop10View = view === "top10";

  return (
    <Box
      data-testid="heatmap-page"
      sx={{ width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", p: 0, gap: 0, overflow: "hidden" }}
    >
      <ToolbarRow
        gap={8}
        style={{ padding: "0 16px", minHeight: 48, height: 48, borderBottom: "1px solid var(--mui-palette-divider)", flexShrink: 0 }}
        data-testid="heatmap-toolbar"
      >
        <Text data-testid="heatmap-title" fw={700} size="sm">NSE 500</Text>
        <Badge data-testid="heatmap-badge" variant="light" color={heatmapData?.cached ? "success" : "primary"}>
          {heatmapData?.cached ? "Cached" : "Live"}
        </Badge>
        <Select
          data-testid="heatmap-sector-filter"
          size="xs"
          w={180}
          placeholder="Filter by sector"
          clearable
          value={sectorFilter}
          onChange={setSectorFilter}
          data={sectorOptions}
          searchable
          aria-label="Sector filter"
        />
        <TextInput
          data-testid="heatmap-search"
          size="xs"
          w={140}
          placeholder="Search symbol..."
          value={searchFilter}
          onChange={(val) => setSearchFilter(val)}
          aria-label="Search symbol"
        />
        {!isScatterView && (
          <Select
            data-testid="heatmap-metric"
            size="xs"
            w={130}
            label="Metric"
            value={metric}
            onChange={(v) => setMetric(v || "market_cap")}
            data={metricOptions}
            aria-label="Metric"
          />
        )}
        <Select
          data-testid="heatmap-view"
          size="xs"
          w={130}
          label="View"
          value={view}
          onChange={(v) => setView(v || "treemap")}
          data={VIEWS}
          aria-label="View"
        />
        <Box sx={{ flex: 1 }} />
        <Text
          data-testid="heatmap-stock-count"
          size="xs"
          c="dimmed"
          sx={{ cursor: "pointer", whiteSpace: "nowrap" }}
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          title="Toggle sort direction"
        >
          {filteredStocks.length} stocks {sortDir === "desc" ? "↓" : "↑"}
        </Text>
      </ToolbarRow>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        <LoadingOverlay visible={heatmapLoading} />
        {heatmapError && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, width: "100%" }}>
            <Text data-testid="heatmap-error" c="error">Error: {heatmapError.message || "Failed to load"}</Text>
          </Box>
        )}
        {!heatmapLoading && !heatmapError && filteredStocks.length === 0 && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, width: "100%" }}>
            <Text size="sm" c="dimmed">No stocks match the current filters.</Text>
          </Box>
        )}
        {!heatmapLoading && isChartView && filteredStocks.length > 0 && (
          <HeatmapTreemap
            stocks={filteredStocks}
            metric={metric}
            showLegend={false}
            testId="heatmap-page-treemap"
          />
        )}
        {isTableView && (
          <HeatmapListView
            stocks={filteredStocks}
            metric={metric}
            activeMetric={activeMetric}
            metricMin={metricMin}
            metricMax={metricMax}
          />
        )}
        {!heatmapLoading && isScatterView && (
          <ScatterView
            stocks={filteredStocks}
            metricX={scatterMetricX}
            metricY={scatterMetricY}
            onMetricXChange={setScatterMetricX}
            onMetricYChange={setScatterMetricY}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        )}
        {!heatmapLoading && isDistView && (
          <DistributionView
            stocks={filteredStocks}
            metric={metric}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        )}
        {!heatmapLoading && isSectorView && (
          <SectorBarView
            stocks={filteredStocks}
            metric={metric}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            METRICS={METRICS}
          />
        )}
        {!heatmapLoading && isTop10View && (
          <TopBottomView
            stocks={filteredStocks}
            metric={metric}
            getMetricValue={getMetricValue}
            getMetricColor={getMetricColor}
            getMetricTextColor={getMetricTextColor}
            METRICS={METRICS}
          />
        )}
      </Box>

      <Box
        data-testid="heatmap-legend"
        sx={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 2, px: 2, height: 32, minHeight: 32, borderTop: "1px solid var(--mui-palette-divider)", overflow: "hidden" }}
      >
        <Text size="xs" fw={600} data-testid="heatmap-legend-label">{activeMetric.label}</Text>
        <Box sx={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMin, metricMin, metricMax), borderRadius: "2px", flexShrink: 0 }} />
        <Text size="xs" data-testid="heatmap-legend-min">{activeMetric.fmt(metricMin)}</Text>
        <Box sx={{ flex: 1, maxWidth: 120, height: 8, borderRadius: "4px", background: `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
        <Box sx={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMax, metricMin, metricMax), borderRadius: "2px", flexShrink: 0 }} />
        <Text size="xs" data-testid="heatmap-legend-max">{activeMetric.fmt(metricMax)}</Text>
      </Box>
    </Box>
  );
}
