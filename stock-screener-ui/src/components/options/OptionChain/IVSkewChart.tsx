import { Text, useColorScheme } from "@/ui";
import { Box } from "@/ui";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import * as palette from "@/ui/palette";
import { CompactPanel } from "../../common/compact";

interface IVSkewChartProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
}

export function IVSkewChart({ strikeMatrix }: IVSkewChartProps) {
  const { colorScheme } = useColorScheme();
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
      backgroundColor: isDark ? palette.CHART_DROPDOWN : palette.SURFACE,
      textStyle: {
        color: isDark ? palette.TEXT : "#0D1117",
        fontSize: 12,
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
      axisLabel: { color: palette.TEXT_MUTED, fontSize: 12 },
      axisLine: { lineStyle: { color: palette.BORDER } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: palette.TEXT_MUTED, fontSize: 12, formatter: "{value}%" },
      splitLine: {
        lineStyle: { color: palette.BORDER, type: "dashed" },
      },
    },
    series: [
      {
        data: chartData.map((d) => d.iv),
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 3, color: palette.PRIMARY },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: palette.IV_AREA_START },
              { offset: 1, color: palette.IV_AREA_END },
            ],
          },
        },
      },
    ],
  };

  return (
    <CompactPanel className="iv-skew-chart-panel" data-testid="options-iv-skew-chart">
      <Box className="flex items-center justify-center w-full iv-skew-header" gap={1} p="sm">
        <Text size="sm" fw={800} className="text-fin-primary" style={{ letterSpacing: "0.5px" }}>
          VOLATILITY SMILE (IV SKEW)
        </Text>
        <Text size="sm" className="text-fin-text-muted">
          Predicts market turbulence
        </Text>
      </Box>
      <ReactECharts option={option} style={{ height: "148px" }} opts={{ renderer: "svg" }} className="iv-skew-chart" />
    </CompactPanel>
  );
}
