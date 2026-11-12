import { Text, useColorScheme } from "@/ui";
import { Box } from "@/ui";
import { createEffect, createMemo, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import * as palette from "@/ui/palette";
import { CompactPanel } from "../../common/compact";
import { loadEcharts } from "@/utils/loadEcharts";

interface IVSkewChartProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
}

export function IVSkewChart(props: IVSkewChartProps) {
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";

  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const chartData = createMemo(() =>
    props.strikeMatrix
      .map((s) => ({
        strike: s.strike,
        iv: s.ce?.option_greeks?.iv || s.pe?.option_greeks?.iv || 0,
      }))
      .filter((d) => d.iv > 0),
  );

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null, { renderer: "svg" }) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const data = chartData();
    const option = {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const dataPoint = params[0];
          return `Strike: ${dataPoint.name}<br/>IV: ${dataPoint.value}%`;
        },
        "background-color": isDark() ? palette.CHART_DROPDOWN : palette.SURFACE,
        textStyle: {
          color: isDark() ? palette.TEXT : "#0D1117",
          "font-size": 12,
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
        data: data.map((d) => d.strike),
        axisLabel: { color: palette.TEXT_MUTED, "font-size": 12 },
        axisLine: { lineStyle: { color: palette.BORDER } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: palette.TEXT_MUTED, "font-size": 12, formatter: "{value}%" },
        splitLine: {
          lineStyle: { color: palette.BORDER, type: "dashed" },
        },
      },
      series: [
        {
          data: data.map((d) => d.iv),
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
    void applyOption(option);
  });

  onMount(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = undefined;
  });

  return (
    <CompactPanel className="iv-skew-chart-panel" data-testid="options-iv-skew-chart">
      <Box className="flex items-center justify-center w-full iv-skew-header" gap={1} p="sm">
        <Text size="sm" fw={800} className="text-fin-primary" style={{ "letter-spacing": "0.5px" }}>
          VOLATILITY SMILE (IV SKEW)
        </Text>
        <Text size="sm" className="text-fin-text-muted">
          Predicts market turbulence
        </Text>
      </Box>
      <div
        ref={(el) => (chartEl = el)}
        className="iv-skew-chart"
        style={{ height: "148px", width: "100%" }}
      />
    </CompactPanel>
  );
}
