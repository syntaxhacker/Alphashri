import { Paper, Text, Group, useMantineColorScheme, useMantineTheme } from "@mantine/core";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

interface IVSkewChartProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
}

export function IVSkewChart({ strikeMatrix }: IVSkewChartProps) {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const chartData = useMemo(() => {
    return strikeMatrix
      .map((s) => ({
        strike: s.strike,
        iv: s.ce?.option_greeks?.iv || s.pe?.option_greeks?.iv || 0,
      }))
      .filter((d) => d.iv > 0);
  }, [strikeMatrix]);

  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      formatter: (params: any) => {
        const data = params[0];
        return `Strike: ${data.name}<br/>IV: ${data.value}%`;
      },
      backgroundColor: isDark ? "#25262b" : "#fff",
      borderColor: isDark ? "#373a40" : "#dee2e6",
      textStyle: { color: isDark ? "#c1c2c5" : "#000", fontSize: theme.fontSizes.sm },
    },
    grid: {
      top: 10,
      left: 40,
      right: 10,
      bottom: 25,
    },
    xAxis: {
      type: "category",
      data: chartData.map((d) => d.strike),
      axisLabel: { color: "gray", fontSize: theme.fontSizes.sm },
      axisLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "gray", fontSize: theme.fontSizes.sm, formatter: "{value}%" },
      splitLine: { lineStyle: { color: isDark ? "#1a1b1e" : "#f1f3f5", type: "dashed" } },
    },
    series: [
      {
        data: chartData.map((d) => d.iv),
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 3, color: "#228be6" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(34, 139, 230, 0.3)" },
              { offset: 1, color: "rgba(34, 139, 230, 0)" },
            ],
          },
        },
      },
    ],
  };

  const paperStyle = {
    background: "light-dark(var(--mantine-color-white), var(--mantine-color-dark-7))",
    border: "1px solid light-dark(var(--mantine-color-gray-3), var(--mantine-color-dark-4))",
  };

  return (
    <Paper
      p="md"
      radius="md"
      style={paperStyle}
      className="iv-skew-chart-panel"
      data-testid="options-iv-skew-chart"
    >
      <Group justify="space-between" mb="sm" className="iv-skew-header">
        <Text size="sm" fw={800} c="blue.6" style={{ letterSpacing: "0.5px" }}>
          VOLATILITY SMILE (IV SKEW)
        </Text>
        <Text size="sm" c="dimmed">
          Predicts market turbulence
        </Text>
      </Group>
      <ReactECharts
        option={option}
        style={{ height: "160px" }}
        opts={{ renderer: "svg" }}
        className="iv-skew-chart"
      />
    </Paper>
  );
}
