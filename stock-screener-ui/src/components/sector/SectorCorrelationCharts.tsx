import { useEffect } from "react";
import { Box } from "@mantine/core";
import { useECharts } from "../../hooks/useECharts";
import type { SectorCorrelationResponse } from "../../types/sector";

// Diverging blue → white → red color stops
const COLOR_STOPS = [
  { color: "#2166ac", pos: 0.0 },
  { color: "#67a9cf", pos: 0.2 },
  { color: "#f7f7f7", pos: 0.4 },
  { color: "#fddbc7", pos: 0.6 },
  { color: "#ef8a62", pos: 0.8 },
  { color: "#b2182b", pos: 1.0 },
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

  const srgb = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const contrastWhite = 1.05 / (lum + 0.05);
  const contrastBlack = (lum + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? "#ffffff" : "#111111";
}

function chartColors(isDark: boolean) {
  return {
    axisLabel: isDark ? "#ccc" : "#333",
    axisLine: isDark ? "#555" : "#ccc",
    splitLine: isDark ? "#333" : "#e0e0e0",
    border: isDark ? "#2a2a2a" : "#fff",
  };
}

export function CorrelationHeatmap({
  matrix,
  symbols,
  isDark,
}: {
  matrix: number[][];
  symbols: string[];
  isDark: boolean;
}) {
  const { chartRef, setChartOption } = useECharts({ isDark });
  const hasData = matrix.length > 0 && symbols.length > 0;
  const colors = chartColors(isDark);

  useEffect(() => {
    if (!hasData) return;

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

    setChartOption({
      backgroundColor: "transparent",
      tooltip: {
        position: "top" as const,
        formatter: (p: any) =>
          `${symbols[p.data[1]]} × ${symbols[p.data[0]]}<br/>Correlation: ${(p.data[2] * 100).toFixed(1)}%`,
      },
      grid: { left: 100, right: 80, top: 10, bottom: 100 },
      xAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { rotate: 45, fontSize: 10, color: colors.axisLabel },
        axisLine: { lineStyle: { color: colors.axisLine } },
      },
      yAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { fontSize: 11, color: colors.axisLabel },
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
        textStyle: { color: colors.axisLabel, fontSize: 10 },
      },
      series: [
        {
          type: "heatmap",
          data: heatmapData,
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 700,
            formatter: (p: any) => Math.round(p.data.value[2] * 100) + "%",
          },
          itemStyle: { borderColor: colors.border, borderWidth: 1 },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" },
            label: { show: true },
          },
        },
      ],
    });
  }, [hasData, matrix, symbols, setChartOption]);

  const minHeight = hasData ? Math.max(300, symbols.length * 40 + 120) : 300;
  return (
    <Box pos="relative" style={{ minHeight }}>
      <Box ref={chartRef} style={{ minHeight, opacity: hasData ? 1 : 0 }} />
    </Box>
  );
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
