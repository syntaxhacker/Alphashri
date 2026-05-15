import { useState, useMemo, useRef } from "react";
import {
  Box,
  Flex,
  Text,
  Group,
  Select,
  TextInput,
  LoadingOverlay,
  Badge,
} from "@mantine/core";
import { useMantineColorScheme } from "@mantine/core";
import ReactECharts from "echarts-for-react";
import { useAsyncData } from "../../hooks/useAsyncData";
import { fetchHeatmapData, fetchHeatmapSectors, type SectorInfo } from "../../api/heatmap";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
} from "../../config/colors";
import { METRICS, getMetricValue, getMetricColor, getMetricTextColor, formatMarketCap } from "./heatmapUtils";
import { ScatterView } from "./ScatterView";
import { DistributionView } from "./DistributionView";
import { SectorBarView } from "./SectorBarView";
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
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const chartRef = useRef<any>(null);

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

  const chartOption = useMemo(() => {
    const data = filteredStocks.map((stock) => {
      const mv = getMetricValue(stock, metric);
      const color = getMetricColor(mv, metricMin, metricMax);
      const textColor = getMetricTextColor(mv, metricMin, metricMax);
      return {
        name: stock.symbol,
        value: 1,
        path: stock.symbol,
        nameFull: stock.name,
        sector: stock.sector,
        price: stock.price,
        change: stock.change_pct,
        mcap: stock.market_cap,
        pe: stock.pe_ratio,
        metricLabel: activeMetric.label,
        metricValue: activeMetric.fmt(mv),
        label: { color: textColor },
        itemStyle: { color },
      };
    });

    const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
    const tooltipBorder = isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER;
    const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText },
        formatter: (params: any) => {
          const d = params.data;
          if (!d) return "";
          return [
            `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.name}</div>`,
            `<div style="color:${tooltipText};font-size:12px;opacity:0.8">${d.nameFull}</div>`,
            `<div style="margin-top:8px">`,
            `  <div style="color:${tooltipText}">${d.metricLabel}: <b>${d.metricValue}</b></div>`,
            `  <div style="color:${tooltipText}">P/E: <b>${d.pe}</b></div>`,
            `  <div style="color:${tooltipText}">MCap: <b>${formatMarketCap(d.mcap)}</b></div>`,
            `  <div style="color:${tooltipText}">Price: <b>₹${d.price?.toFixed(2) || "-"}</b></div>`,
            `  <div style="color:${d.change >= 0 ? "green" : "red"}">Change: <b>${d.change >= 0 ? "+" : ""}${d.change?.toFixed(2)}%</b></div>`,
            `  <div style="color:${tooltipText}">Sector: ${d.sector || "-"}</div>`,
            `</div>`,
          ].join("\n");
        },
      },
      series: [
        {
          type: "treemap",
          sort: false,
          width: "100%",
          height: "100%",
          roam: false,
          squareRatio: 1,
          label: {
            show: true,
            formatter: (params: any) =>
              `${params.name}\n${params.data?.metricValue}`,
            fontSize: 10,
            fontWeight: "bold",
            lineHeight: 14,
            textBorderColor: "#000",
            textBorderWidth: 0.5,
          },
          breadcrumb: { show: false },
          itemStyle: {
            borderColor: isDark ? "#1a1a1a" : "#fff",
            borderWidth: 1,
            gapWidth: 0,
          },
          levels: [
            { itemStyle: { borderColor: isDark ? "#1a1a1a" : "#fff", borderWidth: 0, gapWidth: 0 } },
            { colorSaturation: [0.35, 0.5], itemStyle: { borderColorSaturation: 0.6, gapWidth: 0, borderWidth: 1 } },
          ],
          data,
        },
      ],
    };
  }, [filteredStocks, activeMetric, metric, metricMin, metricMax, isDark]);

  const metricOptions = METRICS.map((m) => ({ value: m.value, label: m.label }));

  const isTableView = view === "list" || view === "top10";
  const isChartView = view === "treemap";
  const isScatterView = view === "scatter";
  const isDistView = view === "distribution";
  const isSectorView = view === "sectors";
  const isTop10View = view === "top10";

  return (
    <Box data-testid="heatmap-page" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <Box p="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Flex justify="space-between" align="center" wrap="wrap" gap="sm">
          <Group gap="xs">
            <Text data-testid="heatmap-title" fw={700} size="lg">🇮🇳 NSE 500 · P/E Forward</Text>
            <Badge data-testid="heatmap-badge" variant="light" color={heatmapData?.cached ? "green" : "blue"}>
              {heatmapData?.cached ? "Cached" : "Live"}
            </Badge>
          </Group>
        </Flex>
        <Group mt="sm" gap="sm" wrap="wrap">
          <Select
            data-testid="heatmap-sector-filter"
            size="xs"
            placeholder="Filter by sector"
            clearable
            value={sectorFilter}
            onChange={setSectorFilter}
            data={sectorOptions}
            style={{ width: 180 }}
            searchable
          />
          <TextInput
            data-testid="heatmap-search"
            size="xs"
            placeholder="Search symbol..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            style={{ width: 140 }}
          />
          {!isScatterView && (
            <Select
              data-testid="heatmap-metric"
              size="xs"
              label="Metric"
              value={metric}
              onChange={(v) => setMetric(v || "market_cap")}
              data={metricOptions}
              style={{ width: 130 }}
            />
          )}
          <Select
            data-testid="heatmap-view"
            size="xs"
            label="View"
            value={view}
            onChange={(v) => setView(v || "treemap")}
            data={VIEWS}
            style={{ width: 130 }}
          />
          <Text data-testid="heatmap-stock-count" size="xs" c="dimmed">{filteredStocks.length} stocks</Text>
        </Group>
      </Box>

      <Box style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <LoadingOverlay visible={heatmapLoading} />
        {heatmapError && (
          <Flex justify="center" align="center" h={200}>
            <Text data-testid="heatmap-error" c="red">Error: {heatmapError.message || "Failed to load"}</Text>
          </Flex>
        )}
        {!heatmapLoading && isChartView && (
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
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

      <Box data-testid="heatmap-legend" p="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Group gap="md">
          <Text size="xs" fw={600} data-testid="heatmap-legend-label">{activeMetric.label}</Text>
          <Group gap={4}>
            <Box style={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMin, metricMin, metricMax), borderRadius: 2 }} />
            <Text size="xs" data-testid="heatmap-legend-min">{activeMetric.fmt(metricMin)}</Text>
          </Group>
          <Box style={{ flex: 1, maxWidth: 120, height: 8, borderRadius: 4, background: "linear-gradient(to right, rgb(0,90,30), rgb(80,185,70), rgb(245,230,60), rgb(235,130,40), rgb(175,35,35))" }} />
          <Group gap={4}>
            <Box style={{ width: 12, height: 12, backgroundColor: getMetricColor(metricMax, metricMin, metricMax), borderRadius: 2 }} />
            <Text size="xs" data-testid="heatmap-legend-max">{activeMetric.fmt(metricMax)}</Text>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}