import { useEffect } from "react";
import { Box, Loader, Flex, Stack, Text } from "@mantine/core";
import { useECharts } from "../../hooks/useECharts";
import type { CorrelationDataPoint } from "../../api/correlation";

interface CorrelationChartProps {
  normalized: Record<string, CorrelationDataPoint[]>;
  symbols: string[];
  isLoading?: boolean;
}

const COLORS = [
  "#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de",
  "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc", "#5470c6",
];

export function CorrelationChart({ normalized, symbols, isLoading }: CorrelationChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: false });

  const hasData = normalized && symbols && symbols.length > 0;

  useEffect(() => {
    if (!hasData) return;

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

    setChartOption({
      tooltip: {
        trigger: "axis" as const,
        axisPointer: { type: "cross" as const },
        formatter: (params: any[]) => {
          if (!params || params.length === 0) return "";
          const ts = params[0].axisValue;
          let html = `<div style="font-weight:bold;margin-bottom:4px">${ts}</div>`;
          params.forEach((p: any) => {
            html += `<div style="display:flex;justify-content:space-between;gap:12px">
              <span style="color:${p.color}">● ${p.seriesName}</span>
              <span>${p.value !== null ? `${p.value.toFixed(2)}%` : "N/A"}</span>
            </div>`;
          });
          return html;
        },
      },
      legend: {
        data: symbols,
        top: 0,
        type: "scroll" as const,
        textStyle: { fontSize: 11, color: "#fff" },
      },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: {
        type: "category" as const,
        data: sortedTimestamps,
        axisLabel: {
          fontSize: 10,
          rotate: 30,
          formatter: (val: string) => {
            const d = new Date(val);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          },
        },
        axisLine: { lineStyle: { color: "#888" } },
      },
      yAxis: {
        type: "value" as const,
        name: "% Change",
        nameTextStyle: { fontSize: 11, color: "#fff" },
        axisLabel: { fontSize: 10, formatter: "{value}%", color: "#fff" },
        splitLine: { lineStyle: { type: "dashed", color: "#444" } },
        axisLine: { lineStyle: { color: "#888" } },
      },
      series,
    });
  }, [hasData, normalized, symbols, setChartOption]);

  return (
    <Box pos="relative" style={{ minHeight: 300 }}>
      <Box
        data-testid="correlation-chart"
        ref={chartRef}
        flex={1}
        style={{ minHeight: 300, opacity: hasData ? 1 : 0 }}
      />
      {isLoading && (
        <Flex pos="absolute" inset={0} justify="center" align="center" style={{ zIndex: 1 }}>
          <Stack align="center" gap="xs">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Loading chart data...</Text>
          </Stack>
        </Flex>
      )}
      {!isLoading && !hasData && (
        <Flex pos="absolute" inset={0} justify="center" align="center">
          <Text size="sm" c="dimmed">No chart data available</Text>
        </Flex>
      )}
    </Box>
  );
}
