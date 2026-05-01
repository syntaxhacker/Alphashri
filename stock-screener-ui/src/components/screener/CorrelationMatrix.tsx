import { useEffect } from "react";
import { Box, Loader, Flex, Stack, Text } from "@mantine/core";
import { useECharts } from "../../hooks/useECharts";

interface CorrelationMatrixProps {
  matrix: number[][];
  symbols: string[];
  isLoading?: boolean;
}

export function CorrelationMatrix({ matrix, symbols, isLoading }: CorrelationMatrixProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: false });

  const hasData = matrix && symbols && matrix.length > 0 && symbols.length > 0;

  useEffect(() => {
    if (!hasData) return;

    const n = symbols.length;
    const heatmapData: [number, number, number][] = [];
    for (let i = 0; i < n; i++) {
      const row = matrix[i];
      if (!row) continue;
      for (let j = 0; j < n; j++) {
        heatmapData.push([j, i, Math.round(row[j] * 100) / 100]);
      }
    }

    setChartOption({
      tooltip: {
        position: "top" as const,
        formatter: (p: any) =>
          `${symbols[p.data[1]]} × ${symbols[p.data[0]]}<br/>${p.data[2].toFixed(2)}`,
      },
      grid: { left: 100, right: 80, top: 10, bottom: 100 },
      xAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { rotate: 45, fontSize: 11, color: "#fff" },
        axisLine: { lineStyle: { color: "#555" } },
      },
      yAxis: {
        type: "category" as const,
        data: symbols,
        axisLabel: { fontSize: 13, color: "#fff", fontWeight: 600 },
        axisLine: { lineStyle: { color: "#555" } },
      },
      visualMap: {
        min: -1,
        max: 1,
        calculable: true,
        orient: "vertical" as const,
        right: 0,
        top: "center",
        inRange: {
          color: ["#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b"],
        },
        textStyle: { color: "#fff", fontSize: 11 },
      },
      series: [
        {
          type: "heatmap",
          data: heatmapData,
          label: {
            show: true,
            fontSize: 14,
            fontWeight: 700,
            formatter: (p: any) => p.data[2].toFixed(2),
            color: (p: any) => (Math.abs(p.data[2]) > 0.55 ? "#fff" : "#222"),
          },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.5)" },
          },
        },
      ],
    });
  }, [hasData, matrix, symbols, setChartOption]);

  const minHeight = hasData ? Math.max(300, symbols.length * 50 + 120) : 300;

  return (
    <Box pos="relative" style={{ minHeight }}>
      <Box
        data-testid="correlation-matrix"
        ref={chartRef}
        style={{ minHeight, opacity: hasData ? 1 : 0 }}
      />
      {isLoading && (
        <Flex pos="absolute" inset={0} justify="center" align="center" style={{ zIndex: 1 }}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading correlation data...
            </Text>
          </Stack>
        </Flex>
      )}
      {!isLoading && !hasData && (
        <Flex pos="absolute" inset={0} justify="center" align="center">
          <Text size="sm" c="dimmed">
            No correlation data available
          </Text>
        </Flex>
      )}
    </Box>
  );
}
