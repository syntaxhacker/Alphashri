import { useCallback, useMemo, useRef } from "react";
import { Box, Stack, Text } from "@/ui";
import { Select } from "@/ui";
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
  changePositive: "#3fb950",
  changeNegative: "#f85149",
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
    <Box data-testid={testId} className="flex flex-col gap-0 flex-1 min-h-0 w-full overflow-hidden">
      <Stack spacing={0} className="w-full flex-1 min-h-0">
        {showMetricSelect && onMetricChange && (
          <Box className="flex items-center gap-2 px-2 h-10 flex-shrink-0 border-b border-fin-border">
            <Text size="xs" c="dimmed">Color by</Text>
            <Select
              size="small"
              value={metricKey}
              onChange={(v) => onMetricChange(v ?? metrics[0].value)}
              data={metrics.map((m) => ({ value: m.value, label: m.label }))}
              className="min-w-[140px]"
              data-testid={`${testId}-metric`}
            />
            <Text size="xs" c="dimmed">{stocks.length} stocks</Text>
          </Box>
        )}
        <Box className={`flex-1 min-h-[${typeof chartHeight === "number" ? chartHeight : 320}px] w-full flex p-2`}>
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "100%", width: "100%" }}
            opts={{ renderer: "canvas" }}
            onEvents={onSymbolClick ? { click: handleChartClick } : undefined}
          />
        </Box>
        {showLegend && stocks.length > 0 && (
          <Box className="flex items-center gap-2 px-2 h-8 flex-shrink-0 border-t border-fin-border">
            <Text size="xs" fw={600}>{activeMetric.label}</Text>
            <Box className="size-3 rounded" style={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMin, metricMin, metricMax), borderRadius: "2px" }} />
            <Text size="xs">{activeMetric.fmt(metricMin)}</Text>
            <Box className="flex-1 max-w-[120px] h-[8px] rounded-[4px]" style={{ background: isSignedHeatmapMetric(metricKey) ? `linear-gradient(to right, ${SECTOR_STRONG_RED}, ${SECTOR_NEUTRAL}, ${SECTOR_GREEN})` : `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
            <Box className="size-3 rounded" style={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMax, metricMin, metricMax), borderRadius: "2px" }} />
            <Text size="xs">{activeMetric.fmt(metricMax)}</Text>
          </Box>
        )}
      </Stack>
    </Box>
  );
}
