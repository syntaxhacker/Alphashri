import { useCallback, useMemo, useRef } from "react";
import { Box, Stack, Text } from "@/ui";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ReactECharts from "echarts-for-react";
import type { HeatmapStock } from "../../api/heatmap";
import {
  BG,
  SURFACE,
  CREAM,
  SECTOR_STRONG_GREEN,
  SECTOR_GREEN,
  SECTOR_NEUTRAL,
  SECTOR_RED,
  SECTOR_STRONG_RED,
} from "../../config/colors";
import {
  METRICS,
  getHeatmapMetricColor,
  isSignedHeatmapMetric,
  type MetricConfig,
} from "./heatmapUtils";
import {
  buildStockTreemapOption,
  getStockMetricRange,
  resolveStockMetric,
  type StockTreemapStyle,
} from "../../components/heatmap/stockTreemap";

/** Surface-specific look: NSE heatmap tiles. Shared data/tooltip live in stockTreemap.ts. */
const HEATMAP_TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: SURFACE,
  borderLight: CREAM,
  label: {
    fontSize: 10,
    fontWeight: "bold",
    lineHeight: 14,
    textBorderColor: BG,
    textBorderWidth: 0.5,
  },
  colorSaturation: [0.35, 0.5],
  changePositive: "var(--mui-palette-success-main)",
  changeNegative: "var(--mui-palette-error-main)",
};

export interface HeatmapTreemapProps {
  stocks: HeatmapStock[];
  metric: string;
  onMetricChange?: (metric: string) => void;
  metrics?: MetricConfig[];
  showMetricSelect?: boolean;
  showLegend?: boolean;
  chartHeight?: number | string;
  onSymbolClick?: (symbol: string) => void;
  testId?: string;
}

export function HeatmapTreemap({
  stocks,
  metric,
  onMetricChange,
  metrics = METRICS,
  showMetricSelect = false,
  showLegend = true,
  chartHeight = 320,
  onSymbolClick,
  testId = "heatmap-treemap",
}: HeatmapTreemapProps) {
  const isDark = typeof document !== "undefined" ? document.documentElement.getAttribute("data-dark") === "true" : false;
  const chartRef = useRef<ReactECharts>(null);

  const activeMetric = resolveStockMetric(metrics, metric);
  const metricKey = activeMetric.value;

  const { min: metricMin, max: metricMax } = useMemo(
    () => getStockMetricRange(stocks, metricKey),
    [stocks, metricKey],
  );
  const handleChartClick = useCallback(
    (params: { name?: string }) => {
      if (params?.name) onSymbolClick?.(params.name);
    },
    [onSymbolClick],
  );

  const chartOption = useMemo(
    () => buildStockTreemapOption(stocks, metricKey, metrics, isDark, HEATMAP_TREEMAP_STYLE),
    [stocks, metricKey, metrics, isDark],
  );

  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 0, flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>
      <Stack spacing={0} sx={{ width: "100%", flex: 1, minHeight: 0 }}>
        {showMetricSelect && onMetricChange && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, height: 40, flexShrink: 0, borderBottom: "1px solid var(--mui-palette-divider)" }}>
            <Text size="xs" c="dimmed">Color by</Text>
            <Select size="small" value={metricKey} onChange={(e) => onMetricChange(String(e.target.value) || metrics[0].value)} sx={{ minWidth: 140 }} data-testid={`${testId}-metric`}>
              {metrics.map((m) => (<MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>))}
            </Select>
            <Text size="xs" c="dimmed">{stocks.length} stocks</Text>
          </Box>
        )}
        <Box sx={{ flex: 1, minHeight: typeof chartHeight === "number" ? chartHeight : 320, width: "100%", display: "flex", p: 1 }}>
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            onEvents={onSymbolClick ? { click: handleChartClick } : undefined}
          />
        </Box>
        {showLegend && stocks.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, height: 32, flexShrink: 0, borderTop: "1px solid var(--mui-palette-divider)" }}>
            <Text size="xs" fw={600}>{activeMetric.label}</Text>
            <Box sx={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMin, metricMin, metricMax), borderRadius: "2px" }} />
            <Text size="xs">{activeMetric.fmt(metricMin)}</Text>
            <Box sx={{ flex: 1, maxWidth: 120, height: 8, borderRadius: "4px", background: isSignedHeatmapMetric(metricKey) ? `linear-gradient(to right, ${SECTOR_STRONG_RED}, ${SECTOR_NEUTRAL}, ${SECTOR_GREEN})` : `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
            <Box sx={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMax, metricMin, metricMax), borderRadius: "2px" }} />
            <Text size="xs">{activeMetric.fmt(metricMax)}</Text>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
