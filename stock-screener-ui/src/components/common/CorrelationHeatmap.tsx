import { Show, createEffect, createMemo, onCleanup } from "solid-js";
import { Box, Loader, Flex, Stack, Text, useColorScheme, typeSize } from "@/ui";
import { loadEcharts } from "../../utils/loadEcharts";
import {
  CREAM,
  BLACK,
  BROWN_DARK,
  TRADING_GREEN,
  TRADING_RED,
  SECTOR_GREEN,
  SECTOR_RED,
  SECTOR_LIGHT_GREEN,
  SECTOR_LIGHT_RED,
  CHART_MUTED,
  CHART_LIGHT_TEXT,
  CHART_BORDER,
  CHART_LIGHT_BORDER,
  CHART_SPLIT,
  CHART_LIGHT_BG,
} from "../../config/colors";
import { withAlpha } from "../../utils/color";
import { contrastRatio } from "../../utils/contrast";

const COLOR_STOPS = [
  { color: SECTOR_LIGHT_RED, pos: 0.0 },
  { color: TRADING_RED, pos: 0.2 },
  { color: SECTOR_RED, pos: 0.35 },
  { color: CREAM, pos: 0.5 },
  { color: SECTOR_GREEN, pos: 0.65 },
  { color: TRADING_GREEN, pos: 0.8 },
  { color: SECTOR_LIGHT_GREEN, pos: 1.0 },
];

function getTextColor(value: number): string {
  const t = Math.max(0, Math.min(1, (value + 1) / 2));
  let lower = COLOR_STOPS[0];
  let upper = COLOR_STOPS[COLOR_STOPS.length - 1];
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (t >= COLOR_STOPS[i].pos && t <= COLOR_STOPS[i + 1].pos) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
      break;
    }
  }
  const parseHex = (hex: string) => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  const c1 = parseHex(lower.color);
  const c2 = parseHex(upper.color);
  const seg = upper.pos - lower.pos;
  const local = seg > 0 ? (t - lower.pos) / seg : 0;
  const r = Math.round(c1.r + (c2.r - c1.r) * local);
  const g = Math.round(c1.g + (c2.g - c1.g) * local);
  const b = Math.round(c1.b + (c2.b - c1.b) * local);

  const cell = `rgb(${r}, ${g}, ${b})`;
  return contrastRatio(CREAM, cell) >= contrastRatio(BROWN_DARK, cell) ? CREAM : BROWN_DARK;
}

function chartColors(isDark: boolean) {
  return {
    axisLabel: isDark ? CHART_MUTED : CHART_LIGHT_TEXT,
    axisLine: isDark ? CHART_BORDER : CHART_LIGHT_BORDER,
    border: isDark ? CHART_SPLIT : CHART_LIGHT_BG,
  };
}

interface CorrelationHeatmapProps {
  matrix: number[][];
  symbols: string[];
  isLoading?: boolean;
  isDark?: boolean;
  testId?: string;
  valueFormatter?: (val: number) => string;
}

export function CorrelationHeatmap(props: CorrelationHeatmapProps) {
  const { colorScheme } = useColorScheme();
  const isDark = () => props.isDark ?? colorScheme() === "dark";
  const hasData = createMemo(
    () => Boolean(props.matrix && props.symbols && props.matrix.length > 0 && props.symbols.length > 0),
  );
  const fmt = () => props.valueFormatter ?? ((v: number) => Math.round(v * 100) + "%");

  let chartDiv: HTMLDivElement | undefined;
  /** Room a cell actually gets; drives label size and whether labels fit. */
  const cellPx = () => {
    const width = chartDiv?.clientWidth ?? 0;
    const n = Math.max(1, props.symbols.length);
    const labelRoom = Math.min(100, Math.max(56, Math.round(width * 0.24)));
    return (width - labelRoom * 2) / n;
  };
  /** Below ~34px a cell cannot hold "87%" without it overlapping the border. */
  const showCellLabels = () => cellPx() >= 34;
  const cellLabelSize = () => (cellPx() >= 52 ? typeSize("label") : typeSize("micro"));
  let chartInstance: any = null;

  createEffect(() => {
    if (!hasData()) return;
    const colors = chartColors(isDark());
    const symbols = props.symbols;
    const matrix = props.matrix;
    const format = fmt();

    const n = symbols.length;
    const heatmapData: any[] = [];
    for (let i = 0; i < n; i++) {
      const row = matrix[i];
      if (!row) continue;
      for (let j = 0; j < n; j++) {
        const val = row[j];
        heatmapData.push({
          value: [j, i, Math.round(val * 100) / 100],
          label: { color: getTextColor(val) },
        });
      }
    }

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        position: "top" as const,
        formatter: (p: any) =>
          `${symbols[p.data.value[1]]} × ${symbols[p.data.value[0]]}<br/>Correlation: ${(p.data.value[2] * 100).toFixed(1)}%`,
      },
      /*
       * The label margins were fixed (100 left / 80 right). In a 285px dock
       * window that reserved 180px and left ~15px per column for a 7-sector
       * matrix, so the cells and their numbers mushed together. Scale the
       * margins to the label text instead, and cap them so a wide panel still
       * does not waste space.
       */
      grid: (() => {
        const width = chartDiv?.clientWidth ?? 0;
        const labelRoom = Math.min(100, Math.max(56, Math.round(width * 0.24)));
        return { left: labelRoom, right: labelRoom, top: 10, bottom: labelRoom };
      })(),
      xAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { rotate: 45, fontSize: typeSize("micro"), color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      yAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { fontSize: typeSize("micro"), color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: "vertical" as const,
        right: 0,
        top: "center",
        inRange: { color: COLOR_STOPS.map((c) => c.color) },
        textStyle: { color: colors.axisLabel, fontSize: typeSize("micro") },
      },
      series: [
        {
          type: "heatmap",
          data: heatmapData,
          label: {
            show: showCellLabels(),
            fontSize: cellLabelSize(),
            fontWeight: 700,
            formatter: (p: any) => format(p.data.value[2]),
          },
          itemStyle: { borderColor: colors.border, borderWidth: 1 },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: withAlpha(BLACK, 0.5) },
            label: { show: true },
          },
        },
      ],
    };

    let cancelled = false;
    void loadEcharts().then((echartsLib) => {
      if (cancelled || !echartsLib || !chartDiv) return;
      if (!chartInstance) {
        chartInstance = echartsLib.init(chartDiv, null);
      }
      chartInstance.setOption(option, true);
      chartInstance.resize();
      // Keep the last option so a container resize can re-apply the adaptive
      // margins and label sizes; `resize()` alone would keep the geometry
      // the container had when this effect ran.
      lastOption = option;
    });

    onCleanup(() => {
      cancelled = true;
    });
  });

  let lastOption: Record<string, unknown> | null = null;

  onCleanup(() => {
    if (chartInstance) {
      chartInstance.dispose();
      chartInstance = null;
    }
  });

  /*
   * ECharts sizes itself from the div at `init` time and thereafter only on an
   * explicit `resize()`. Listening to `window.resize` alone left the canvas at
   * whatever size the div happened to have when it first mounted — inside a
   * dock window that is a 100x520 sliver which never grows, so the matrix
   * columns were clipped and the sector labels truncated. Observe the element.
   */
  let resizeObserver: ResizeObserver | null = null;
  const observeChartDiv = (el: HTMLDivElement) => {
    chartDiv = el;
    resizeObserver?.disconnect();
    if (typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(() => {
      if (!chartInstance) return;
      chartInstance.resize();
      if (lastOption) {
        const width = chartDiv?.clientWidth ?? 0;
        const labelRoom = Math.min(100, Math.max(56, Math.round(width * 0.24)));
        chartInstance.setOption(
          { grid: { left: labelRoom, right: labelRoom, top: 10, bottom: labelRoom } },
          false,
        );
      }
    });
    resizeObserver.observe(el);
  };
  onCleanup(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  const handleResize = () => chartInstance?.resize();
  window.addEventListener("resize", handleResize);
  onCleanup(() => window.removeEventListener("resize", handleResize));

  /*
   * The floor keeps a *stacked* layout from collapsing, but it must not force
   * the canvas taller than the box it sits in: the dock renders this chart in
   * a fixed-height cell, and `min-height: 520px` there made the matrix draw
   * past the bottom of its own panel.
   */
  const minHeight = () => {
    if (props.isLoading) return 300;
    if (!hasData()) return 36;
    return Math.min(300, props.symbols.length * 40 + 120);
  };

  return (
    <Box className="flex min-h-0 w-full flex-1 flex-col" style={{ "min-height": `${minHeight()}px` }}>
      <Box
        data-testid={props.testId}
        ref={observeChartDiv}
        className="relative min-h-0 w-full flex-1"
        style={{ opacity: hasData() ? 1 : 0 }}
      />
      <Show when={props.isLoading}>
        <Flex pos="absolute" top={0} right={0} bottom={0} left={0} justify="center" align="center" style={{ "z-index": 1, "pointer-events": "none" }}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading correlation data...
            </Text>
          </Stack>
        </Flex>
      </Show>
      <Show when={!props.isLoading && !hasData()}>
        <Flex pos="absolute" top={0} right={0} bottom={0} left={0} justify="center" align="center" style={{ "pointer-events": "none" }}>
          <Text size="sm" c="dimmed">
            No correlation data available
          </Text>
        </Flex>
      </Show>
    </Box>
  );
}
