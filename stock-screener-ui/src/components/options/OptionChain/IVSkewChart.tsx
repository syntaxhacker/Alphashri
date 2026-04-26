import { Text, Group, useMantineColorScheme, useMantineTheme } from "@mantine/core";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { CompactPanel } from "../../common/compact";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
  AXIS_DARK_LINE,
  AXIS_LIGHT_LINE,
  AXIS_DARK_SPLIT,
  AXIS_LIGHT_SPLIT,
  INDICATOR_LINE,
  IV_AREA_START,
  IV_AREA_END,
} from "../../../config/colors";

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
      backgroundColor: isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG,
      borderColor: isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
      textStyle: {
        color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT,
        fontSize: theme.fontSizes.sm,
      },
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
      axisLine: { lineStyle: { color: isDark ? AXIS_DARK_LINE : AXIS_LIGHT_LINE } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "gray", fontSize: theme.fontSizes.sm, formatter: "{value}%" },
      splitLine: {
        lineStyle: { color: isDark ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT, type: "dashed" },
      },
    },
    series: [
      {
        data: chartData.map((d) => d.iv),
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 3, color: INDICATOR_LINE },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: IV_AREA_START },
              { offset: 1, color: IV_AREA_END },
            ],
          },
        },
      },
    ],
  };

  return (
    <CompactPanel className="iv-skew-chart-panel" data-testid="options-iv-skew-chart">
      <Group justify="space-between" mb="xs" className="iv-skew-header">
        <Text size="sm" fw={800} c="blue.6" style={{ letterSpacing: "0.5px" }}>
          VOLATILITY SMILE (IV SKEW)
        </Text>
        <Text size="sm" c="dimmed">
          Predicts market turbulence
        </Text>
      </Group>
      <ReactECharts
        option={option}
        style={{ height: "148px" }}
        opts={{ renderer: "svg" }}
        className="iv-skew-chart"
      />
    </CompactPanel>
  );
}
