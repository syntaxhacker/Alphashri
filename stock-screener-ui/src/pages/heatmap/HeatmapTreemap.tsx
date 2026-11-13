import * as palette from "@/ui/palette";
import { createMemo, onMount, onCleanup, createEffect, Show } from "solid-js";
import { Box, Stack, Text } from "@/ui";
import { Select } from "@/ui";
import { loadEcharts } from "../../utils/loadEcharts";
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
  safeFmt,
  type StockTreemapStyle,
} from "../../components/heatmap/stockTreemap";

/** Surface-specific look: NSE heatmap tiles. Shared data/tooltip live in stockTreemap.ts. */
const HEATMAP_TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: SURFACE,
  borderLight: CREAM,
  label: {
    "font-size": "10px",
    "font-weight": "bold",
    "line-height": 14,
    textBorderColor: BG,
    textBorderWidth: 0.5,
  },
  colorSaturation: [0.35, 0.5],
  changePositive: palette.POSITIVE_COLOR,
  changeNegative: palette.NEGATIVE_COLOR,
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
  /**
   * Which metrics use a diverging green/red ramp. Defaults to the heatmap's
   * own set; the live market snapshot passes its own because a day change
   * means the opposite of a 1-year return.
   */
  isSignedMetric?: (metric: string) => boolean;
  sizeBy?: "uniform" | "market_cap";
}

export function HeatmapTreemap(props: HeatmapTreemapProps) {
  const isDark = typeof document !== "undefined" ? document.documentElement.getAttribute("data-dark") === "true" : false;
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;

  const metrics = () => props.metrics ?? METRICS;
  const showLegend = () => props.showLegend ?? true;
  const activeMetric = createMemo(() => resolveStockMetric(metrics(), props.metric));
  const metricKey = () => activeMetric().value;

  const metricRange = createMemo(() => getStockMetricRange(props.stocks, metricKey()));
  const metricMin = () => metricRange().min;
  const metricMax = () => metricRange().max;

  const chartOption = createMemo(() =>
    buildStockTreemapOption(props.stocks, metricKey(), metrics(), isDark, HEATMAP_TREEMAP_STYLE, props.sizeBy),
  );

  const handleChartClick = (params: { name?: string }) => {
    if (params?.name) props.onSymbolClick?.(params.name);
  };

  onMount(() => {
    const el = chartEl;
    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    onCleanup(() => window.removeEventListener("resize", resize));

    if (!el) return;
    void loadEcharts().then((echartsLib) => {
      if (disposed || !echartsLib) return;
      const instance = echartsLib.init(el, undefined, { renderer: "canvas" });
      chart = instance;
      instance.setOption(chartOption());
      if (props.onSymbolClick) {
        instance.on("click", handleChartClick);
      }
    });
  });

  createEffect(() => {
    const option = chartOption();
    chart?.setOption(option, { notMerge: true });
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = null;
  });

  return (
    <Box data-testid={props.testId ?? "heatmap-treemap"} className="flex flex-col gap-0 flex-1 min-h-0 w-full overflow-hidden">
      <Stack spacing={0} className="w-full flex-1 min-h-0">
        <Show when={props.showMetricSelect && props.onMetricChange}>
          <Box className="flex items-center gap-2 px-2 h-10 flex-shrink-0 border-b border-fin-border">
            <Text size="xs" c="dimmed">Color by</Text>
            <Select
              size="small"
              value={metricKey()}
              onChange={(v) => props.onMetricChange?.(v ?? metrics()[0].value)}
              data={metrics().map((m) => ({ value: m.value, label: m.label }))}
              className="min-w-[140px]"
              data-testid={`${props.testId ?? "heatmap-treemap"}-metric`}
            />
            <Text size="xs" c="dimmed">{props.stocks.length} stocks</Text>
          </Box>
        </Show>
        <Box
          className="flex-1 w-full flex p-2"
          style={{ "min-height": `${typeof props.chartHeight === "number" ? props.chartHeight : 320}px` }}
        >
          <div ref={(el) => (chartEl = el)} style={{ height: "100%", width: "100%" }} />
        </Box>
        <Show when={showLegend() && props.stocks.length > 0}>
          <Box className="flex items-center gap-2 px-2 h-8 flex-shrink-0 border-t border-fin-border">
            <Text size="xs" fw={600}>{activeMetric().label}</Text>
            <Box className="size-3 rounded" style={{ width: "12px", height: "12px", "background-color": getHeatmapMetricColor(metricKey(), metricMin(), metricMin(), metricMax()), "border-radius": "2px" }} />
            <Text size="xs">{safeFmt(activeMetric(), metricMin())}</Text>
            <Box className="flex-1 max-w-[120px] h-[8px] rounded-[4px]" style={{ background: (props.isSignedMetric ?? isSignedHeatmapMetric)(metricKey()) ? `linear-gradient(to right, ${SECTOR_STRONG_RED}, ${SECTOR_NEUTRAL}, ${SECTOR_GREEN})` : `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})` }} />
            <Box className="size-3 rounded" style={{ width: "12px", height: "12px", "background-color": getHeatmapMetricColor(metricKey(), metricMax(), metricMin(), metricMax()), "border-radius": "2px" }} />
            <Text size="xs">{safeFmt(activeMetric(), metricMax())}</Text>
          </Box>
        </Show>
      </Stack>
    </Box>
  );
}
