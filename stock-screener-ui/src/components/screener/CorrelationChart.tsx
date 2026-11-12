import { Show, createEffect, onCleanup, onMount, createMemo } from "solid-js";
import type * as ECharts from "echarts";
import { Box, Loader, Flex, Stack, Text } from "@/ui";
import { loadEcharts } from "../../utils/loadEcharts";
import type { CorrelationDataPoint } from "../../api/correlation";
import {
  CREAM,
  BLACK,
  BROWN,
  BROWN_DARK,
  TRADING_GREEN,
  TRADING_RED,
  TEXT_MUTED,
  SECTOR_GREEN,
  SECTOR_RED,
  SECTOR_LIGHT_GREEN,
  CHART_MUTED,
  CHART_SPLIT,
} from "../../config/colors";

interface CorrelationChartProps {
  normalized: Record<string, CorrelationDataPoint[]>;
  symbols: string[];
  isLoading?: boolean;
}

const COLORS = [
  CREAM,
  TRADING_GREEN,
  TRADING_RED,
  TEXT_MUTED,
  BROWN,
  BROWN_DARK,
  SECTOR_GREEN,
  SECTOR_RED,
  SECTOR_LIGHT_GREEN,
  BLACK,
];

export function CorrelationChart(props: CorrelationChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const hasData = () =>
    props.normalized != null && props.symbols != null && props.symbols.length > 0;

  const buildOption = () => {
    const { normalized, symbols } = props;
    const allTimestamps = new Set<string>();
    symbols.forEach((sym) => {
      normalized[sym]?.forEach((dp) => allTimestamps.add(dp.timestamp));
    });
    const sortedTimestamps = Array.from(allTimestamps).sort();

    const series = symbols.map((sym, idx) => ({
      name: sym,
      type: "line",
      smooth: true,
      showSymbol: false,
      data: sortedTimestamps.map((ts) => {
        const point = normalized[sym]?.find((dp) => dp.timestamp === ts);
        return point ? point.value : null;
      }),
      lineStyle: { width: 2, color: COLORS[idx % COLORS.length] },
      itemStyle: { color: COLORS[idx % COLORS.length] },
    }));

    return {
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "cross", snap: true },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const ts = params[0].axisValue;
          let html = `<div style="font-weight:bold;margin-bottom:4px">${ts}</div>`;
          params.forEach((p: any) => {
            html += `<div style="display:flex;justify-content:space-between;gap:12px">
              <span style="color:${p.color}">● ${p.seriesName}</span>
              <span>${p.value !== null ? `${Number(p.value).toFixed(2)}%` : "N/A"}</span>
            </div>`;
          });
          return html;
        },
      },
      legend: {
        data: symbols,
        top: 0,
        type: "scroll" as const,
        textStyle: { "font-size": 11, color: CHART_MUTED },
      },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: "category" as const,
        data: sortedTimestamps,
        axisLabel: {
          "font-size": 10,
          rotate: 30,
          formatter: (val: string) => {
            const d = new Date(val);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          },
        },
        axisLine: { lineStyle: { color: CHART_MUTED } },
      },
      yAxis: {
        type: "value" as const,
        name: "% Change",
        nameTextStyle: { "font-size": 11, color: CHART_MUTED },
        axisLabel: { "font-size": 10, formatter: "{value}%", color: CHART_MUTED },
        splitLine: { lineStyle: { type: "dashed", color: CHART_SPLIT } },
        axisLine: { lineStyle: { color: CHART_MUTED } },
      },
      series,
    };
  };

  const option = createMemo(() => (hasData() ? buildOption() : null));

  async function applyOption(next: ReturnType<typeof buildOption>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(next, true);
    chart.resize();
  }

  createEffect(() => {
    const next = option();
    if (!next) return;
    void applyOption(next);
  });

  onMount(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = undefined;
  });

  return (
    <Box pos="relative" className="min-h-[300px]">
      <div
        data-testid="correlation-chart"
        ref={(el) => (chartEl = el)}
        class="min-h-[300px]"
        style={{ opacity: hasData() ? "1" : "0" }}
      />
      <Show when={props.isLoading}>
        <Flex pos="absolute" inset={0} justify="center" align="center" className="z-[1]">
          <Stack align="center" gap="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading chart data...
            </Text>
          </Stack>
        </Flex>
      </Show>
      <Show when={!props.isLoading && !hasData()}>
        <Flex pos="absolute" inset={0} justify="center" align="center">
          <Text size="sm" c="dimmed">
            No chart data available
          </Text>
        </Flex>
      </Show>
    </Box>
  );
}
