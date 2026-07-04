import { useEffect } from "react";
import { Box } from "@/ui";
import { useECharts } from "../../hooks/useECharts";
import type { SectorCorrelationResponse } from "../../types/sector";

export { CorrelationHeatmap } from "../common/CorrelationHeatmap";

function chartColors(isDark: boolean) {
  return {
    axisLabel: isDark ? "#ccc" : "#333",
    axisLine: isDark ? "#555" : "#ccc",
    splitLine: isDark ? "#333" : "#e0e0e0",
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
            color: (p: any) => (p.value >= 1 ? "#e74c3c" : p.value <= 0 ? "#3498db" : "#f39c12"),
          },
          label: {
            show: true,
            position: "top" as const,
            fontSize: 10,
            color: (p: any) => (p.value >= 1 || p.value <= 0 ? "#ffffff" : "#222222"),
            formatter: (p: any) => p.value.toFixed(2),
          },
        },
      ],
      graphic: {
        type: "line",
        shape: { x1: 0, y1: "50%", x2: "100%", y2: "50%" },
        style: { stroke: "#2ecc71", lineDash: [4, 4], lineWidth: 1 },
      },
    });
  }, [sectors, setChartOption]);

  return (
    <Box pos="relative" style={{ width: "100%", height: "100%" }}>
      <Box
        ref={chartRef}
        style={{ width: "100%", height: "100%", opacity: sectors.length ? 1 : 0 }}
      />
      <Box pos="absolute" top={8} left={8} style={{ fontSize: 11, color: "#888" }}>
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
    const barColors = changes.map((c) => (c > 0 ? "#2ecc71" : c < 0 ? "#e74c3c" : "#95a5a6"));

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
            color: "#ffffff",
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
      <Box pos="absolute" top={8} left={8} style={{ fontSize: 11, color: "#888" }}>
        Positive = rank improved (sector gaining strength)
      </Box>
    </Box>
  );
}
