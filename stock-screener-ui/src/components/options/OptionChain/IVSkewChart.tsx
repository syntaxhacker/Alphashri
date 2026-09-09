import { Text, useColorScheme, useTheme } from "@/ui";
import Box from "@mui/material/Box";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { IV_AREA_START, IV_AREA_END, CHART_DROPDOWN } from "@/ui/palette";
import { CompactPanel } from "../../common/compact";

interface IVSkewChartProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
}

export function IVSkewChart({ strikeMatrix }: IVSkewChartProps) {
  const theme = useTheme();
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
      backgroundColor: isDark ? CHART_DROPDOWN : "var(--mui-palette-background-paper)",
      textStyle: {
        color: isDark ? "var(--mui-palette-common-white)" : "var(--mui-palette-text-primary)",
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
      axisLabel: { color: "var(--mui-palette-text-secondary)", fontSize: 12 },
      axisLine: { lineStyle: { color: isDark ? "var(--mui-palette-divider)" : "var(--mui-palette-divider)" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "var(--mui-palette-text-secondary)", fontSize: 12, formatter: "{value}%" },
      splitLine: {
        lineStyle: { color: isDark ? "var(--mui-palette-divider)" : "var(--mui-palette-divider)", type: "dashed" },
      },
    },
    series: [
      {
        data: chartData.map((d) => d.iv),
        type: "line",
        smooth: true,
        symbol: "none",
        lineStyle: { width: 3, color: (theme as any).palette?.primary?.main ?? "var(--mui-palette-primary-main)" },
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
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }} className="iv-skew-header">
        <Text size="sm" fw={800} c="primary" style={{ letterSpacing: "0.5px" }}>
          VOLATILITY SMILE (IV SKEW)
        </Text>
        <Text size="sm" c="dimmed">
          Predicts market turbulence
        </Text>
      </Box>
      <ReactECharts option={option} style={{ height: "148px" }} opts={{ renderer: "svg" }} className="iv-skew-chart" />
    </CompactPanel>
  );
}
