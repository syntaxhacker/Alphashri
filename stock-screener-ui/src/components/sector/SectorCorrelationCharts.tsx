import { createEffect, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import { Box, Stack, Text } from "@/ui";
import { loadEcharts } from "@/utils/loadEcharts";
import type { SectorCorrelationResponse } from "../../types/sector";
import {
  CHART_MUTED,
  CHART_LIGHT_TEXT,
  CHART_BORDER,
  CHART_LIGHT_BORDER,
  CHART_SPLIT,
  CHART_LIGHT_SPLIT,
  SECTOR_STRONG_GREEN,
  SECTOR_STRONG_RED,
  SECTOR_NEUTRAL,
  INDICATOR_BLUE_A,
  INDICATOR_LINE,
  TEXT_MUTED,
  CREAM,
  BROWN_DARK,
} from "../../config/colors";

export { CorrelationHeatmap } from "../common/CorrelationHeatmap";

function chartColors(isDark: boolean) {
  return {
    axisLabel: isDark ? CHART_MUTED : CHART_LIGHT_TEXT,
    axisLine: isDark ? CHART_BORDER : CHART_LIGHT_BORDER,
    splitLine: isDark ? CHART_SPLIT : CHART_LIGHT_SPLIT,
  };
}

function createChart(getOption: () => Record<string, unknown>) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  async function applyOption(next: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(next, true);
    chart.resize();
  }

  createEffect(() => {
    void applyOption(getOption());
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

  return {
    setChartRef(el: HTMLDivElement) {
      chartEl = el;
    },
  };
}

export function SectorBetaChart(props: {
  sectors: SectorCorrelationResponse["sectors"];
  benchmark: string;
  isDark: boolean;
}) {
  const colors = chartColors(props.isDark);

  const chart = createChart(() => {
    const sectors = props.sectors;
    const names = sectors.map((s) => s.name);
    const betas = sectors.map((s) => s.beta_vs_index);
    return {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis" as const,
        formatter: (p: any) => `${p.name}<br/>Beta: ${(p.value ?? 0).toFixed(3)}`,
      },
      grid: { left: 80, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { rotate: 45, "font-size": 10, color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      yAxis: {
        type: "value" as const,
        name: "Beta",
        axisLabel: { color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
        splitLine: { lineStyle: { color: colors.splitLine } },
      },
      series: [
        {
          type: "bar",
          data: betas,
          itemStyle: {
            color: (p: any) => (p.value >= 1 ? SECTOR_STRONG_RED : p.value <= 0 ? INDICATOR_BLUE_A : SECTOR_NEUTRAL),
          },
          label: {
            show: true,
            position: "top" as const,
            "font-size": 10,
            color: (p: any) => (p.value >= 1 || p.value <= 0 ? CREAM : BROWN_DARK),
            formatter: (p: any) => p.value.toFixed(2),
          },
        },
      ],
      graphic: {
        type: "line",
        shape: { x1: 0, y1: "50%", x2: "100%", y2: "50%" },
        style: { stroke: INDICATOR_LINE, lineDash: [4, 4], lineWidth: 1 },
      },
    } as Record<string, unknown>;
  });

  return (
    <Stack spacing={1} className="w-full h-full p-2 flex items-center justify-center">
      <Box className="flex items-center justify-center gap-2 p-2 w-full">
        <Text size="xs" className="flex items-center justify-center">Benchmark: {props.benchmark} | Beta = 1.0 line</Text>
      </Box>
      <Box className="relative w-full h-full flex items-center justify-center p-2">
        <div
          ref={(el) => chart.setChartRef(el)}
          class="w-full h-full flex items-center justify-center"
          style={{ opacity: props.sectors.length ? "1" : "0" }}
        />
      </Box>
    </Stack>
  );
}

export function RotationTimeline(props: {
  sectors: SectorCorrelationResponse["sectors"];
  isDark: boolean;
}) {
  const colors = chartColors(props.isDark);

  const chart = createChart(() => {
    const sorted = [...props.sectors].sort((a, b) => b.rank_change_1m - a.rank_change_1m);
    const names = sorted.map((s) => s.name);
    const changes = sorted.map((s) => s.rank_change_1m);
    const barColors = changes.map((c) => (c > 0 ? SECTOR_STRONG_GREEN : c < 0 ? SECTOR_STRONG_RED : TEXT_MUTED));
    return {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis" as const,
        formatter: (p: any) => `${p.name}<br/>Rank Change: ${p.value > 0 ? "+" : ""}${p.value}`,
      },
      grid: { left: 100, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { rotate: 45, "font-size": 10, color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      yAxis: {
        type: "value" as const,
        name: "Rank Change",
        axisLabel: { color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
        splitLine: { lineStyle: { color: colors.splitLine } },
      },
      series: [
        {
          type: "bar",
          data: changes,
          itemStyle: { color: (p: any) => barColors[p.dataIndex] },
          label: {
            show: true,
            position: "top" as const,
            "font-size": 10,
            color: CREAM,
            formatter: (p: any) => (p.value > 0 ? `+${p.value}` : p.value.toString()),
          },
        },
      ],
    } as Record<string, unknown>;
  });

  return (
    <Stack spacing={1} className="w-full h-full p-2 flex items-center justify-center">
      <Box className="flex items-center justify-center gap-2 p-2 w-full">
        <Text size="xs" className="flex items-center justify-center">Positive = rank improved (sector gaining strength)</Text>
      </Box>
      <Box className="relative w-full h-full flex items-center justify-center p-2">
        <div
          ref={(el) => chart.setChartRef(el)}
          class="w-full h-full flex items-center justify-center"
          style={{ opacity: props.sectors.length ? "1" : "0" }}
        />
      </Box>
    </Stack>
  );
}
