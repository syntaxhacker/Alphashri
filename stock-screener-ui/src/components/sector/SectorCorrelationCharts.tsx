import { useEffect } from "react";
import { Box } from "@/ui";
import { useECharts } from "../../hooks/useECharts";
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

export function SectorBetaChart({
  sectors,
  benchmark,
  isDark,
}: {
  sectors: SectorCorrelationResponse["sectors"];
  benchmark: string;
  isDark: boolean;
}) {
  const { chartRef, setChartOption } = useECharts({ isDark });
  const colors = chartColors(isDark);

  useEffect(() => {
    if (!sectors.length) return;
    const names = sectors.map((s) => s.name);
    const betas = sectors.map((s) => s.beta_vs_index);

    setChartOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis" as const,
        formatter: (p: any) => `${p.name}<br/>Beta: ${(p.value ?? 0).toFixed(3)}`,
      },
      grid: { left: 80, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { rotate: 45, fontSize: 10, color: colors.axisLabel },
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
            fontSize: 10,
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
    });
  }, [sectors, setChartOption]);

  return (
    <Box pos="relative" style={{ width: "100%", height: "100%" }}>
      <Box
        ref={chartRef}
        style={{ width: "100%", height: "100%", opacity: sectors.length ? 1 : 0 }}
      />
      <Box pos="absolute" top={8} left={8} style={{ fontSize: 11, color: CHART_MUTED }}>
        Benchmark: {benchmark} | Beta = 1.0 line
      </Box>
    </Box>
  );
}

export function RotationTimeline({
  sectors,
  isDark,
}: {
  sectors: SectorCorrelationResponse["sectors"];
  isDark: boolean;
}) {
  const { chartRef, setChartOption } = useECharts({ isDark });
  const colors = chartColors(isDark);

  useEffect(() => {
    if (!sectors.length) return;
    const sorted = [...sectors].sort((a, b) => b.rank_change_1m - a.rank_change_1m);
    const names = sorted.map((s) => s.name);
    const changes = sorted.map((s) => s.rank_change_1m);
    const barColors = changes.map((c) => (c > 0 ? SECTOR_STRONG_GREEN : c < 0 ? SECTOR_STRONG_RED : TEXT_MUTED));

    setChartOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis" as const,
        formatter: (p: any) => `${p.name}<br/>Rank Change: ${p.value > 0 ? "+" : ""}${p.value}`,
      },
      grid: { left: 100, right: 30, top: 20, bottom: 40 },
      xAxis: {
        type: "category" as const,
        data: names,
        axisLabel: { rotate: 45, fontSize: 10, color: colors.axisLabel },
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
            fontSize: 10,
            color: CREAM,
            formatter: (p: any) => (p.value > 0 ? `+${p.value}` : p.value.toString()),
          },
        },
      ],
    });
  }, [sectors, setChartOption]);

  return (
    <Box pos="relative" style={{ width: "100%", height: "100%" }}>
      <Box
        ref={chartRef}
        style={{ width: "100%", height: "100%", opacity: sectors.length ? 1 : 0 }}
      />
      <Box pos="absolute" top={8} left={8} style={{ fontSize: 11, color: CHART_MUTED }}>
        Positive = rank improved (sector gaining strength)
      </Box>
    </Box>
  );
}
