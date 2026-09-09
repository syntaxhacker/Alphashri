import { useEffect } from "react";
import { Box, Loader, Flex, Stack, Text, useColorScheme } from "@/ui";
import { useECharts } from "../../hooks/useECharts";
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

  const srgb = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  const contrastWhite = 1.05 / (lum + 0.05);
  const contrastBlack = (lum + 0.05) / 0.05;
  return contrastWhite >= contrastBlack ? CREAM : BROWN_DARK;
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

export function CorrelationHeatmap({
  matrix,
  symbols,
  isLoading,
  isDark: isDarkProp,
  testId,
  valueFormatter,
}: CorrelationHeatmapProps) {
  const { colorScheme } = useColorScheme();
  const isDark = isDarkProp ?? colorScheme === "dark";
  const { chartRef, setChartOption } = useECharts({ isDark });
  const hasData = matrix && symbols && matrix.length > 0 && symbols.length > 0;
  const colors = chartColors(isDark);
  const fmt = valueFormatter ?? ((v: number) => Math.round(v * 100) + "%");

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
          `${symbols[p.data.value[1]]} × ${symbols[p.data.value[0]]}<br/>Correlation: ${(p.data.value[2] * 100).toFixed(1)}%`,
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
            formatter: (p: any) => fmt(p.data.value[2]),
          },
          itemStyle: { borderColor: colors.border, borderWidth: 1 },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: withAlpha(BLACK, 0.5) },
            label: { show: true },
          },
        },
      ],
    });
  }, [hasData, matrix, symbols, setChartOption]);

  const minHeight = hasData ? Math.max(300, symbols.length * 40 + 120) : 300;

  return (
    <Box pos="relative" style={{ minHeight }}>
      <Box data-testid={testId} ref={chartRef} style={{ minHeight, opacity: hasData ? 1 : 0 }} />
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
