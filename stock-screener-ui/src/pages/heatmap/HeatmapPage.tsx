import { useState, useMemo } from "react";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { Box, Text, Select, TextInput, LoadingOverlay, Badge } from "@/ui";
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
    <Container maxWidth="xl" sx={{ py: 2, display: "flex", flexDirection: "column", gap: 1, minHeight: 0, height: "100%", overflow: "hidden", width: "100%", alignItems: "center" }} data-testid="heatmap-page">
      <Card elevation={1} sx={{ flexShrink: 0, width: "100%", p: 1 }}>
        <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", flexWrap: "wrap", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <Text data-testid="heatmap-title" fw={700} size="lg">🇮🇳 NSE 500</Text>
              <Badge data-testid="heatmap-badge" variant="light" color={heatmapData?.cached ? "success" : "primary"}>
                {heatmapData?.cached ? "Cached" : "Live"}
              </Badge>
            </Box>
          </Box>
          <Grid container spacing={2} justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Select
                data-testid="heatmap-sector-filter"
                size="xs"
                placeholder="Filter by sector"
                clearable
                value={sectorFilter}
                onChange={setSectorFilter}
                data={sectorOptions}
                sx={{ width: 180 }}
                searchable
              />
            </Grid>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <TextInput
                data-testid="heatmap-search"
                size="xs"
                placeholder="Search symbol..."
                value={searchFilter}
                onChange={(val) => setSearchFilter(val)}
                sx={{ width: 140 }}
              />
            </Grid>
            {!isScatterView && (
              <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Select
                  data-testid="heatmap-metric"
                  size="xs"
                  label="Metric"
                  value={metric}
                  onChange={(v) => setMetric(v || "market_cap")}
                  data={metricOptions}
                  sx={{ width: 130 }}
                />
              </Grid>
            )}
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Select
                data-testid="heatmap-view"
                size="xs"
                label="View"
                value={view}
                onChange={(v) => setView(v || "treemap")}
                data={VIEWS}
                sx={{ width: 130 }}
              />
            </Grid>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text data-testid="heatmap-stock-count" size="xs" c="dimmed">{filteredStocks.length} stocks</Text>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Box sx={{ flex: 1, overflow: "auto", position: "relative", minHeight: 0, p: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%" }}>
        <LoadingOverlay visible={heatmapLoading} />
        {heatmapError && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, width: "100%" }}>
            <Text data-testid="heatmap-error" c="error">Error: {heatmapError.message || "Failed to load"}</Text>
          </Box>
        )}
        {!heatmapLoading && isChartView && (
          <HeatmapTreemap
            stocks={filteredStocks}
            metric={metric}
            chartHeight={800}
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

      <Card elevation={1} sx={{ flexShrink: 0, width: "100%", p: 1 }} data-testid="heatmap-legend">
        <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
          <Grid container spacing={2} justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text size="xs" fw={600} data-testid="heatmap-legend-label">{activeMetric.label}</Text>
            </Grid>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <Box sx={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMin, metricMin, metricMax), borderRadius: "2px" }} />
              <Text size="xs" data-testid="heatmap-legend-min">{activeMetric.fmt(metricMin)}</Text>
            </Grid>
            <Grid size="auto" sx={{ flex: 1, maxWidth: 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Box sx={{ flex: 1, maxWidth: 120, height: 8, borderRadius: "4px", background: `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
            </Grid>
            <Grid size="auto" sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }}>
              <Box sx={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMax, metricMin, metricMax), borderRadius: "2px" }} />
              <Text size="xs" data-testid="heatmap-legend-max">{activeMetric.fmt(metricMax)}</Text>
            </Grid>
          </Grid>
        </CardContent>
      </Card>
    </Container>
  );
}
