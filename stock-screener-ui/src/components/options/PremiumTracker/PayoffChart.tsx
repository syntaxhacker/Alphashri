import { createEffect, onCleanup, onMount, Show } from "solid-js";
import type * as ECharts from "echarts";
import { Box, Text } from "@/ui";
import {
  breakevens,
  curveSpots,
  payoffAtExpiry,
  payoffCurve,
  type PayoffLeg,
} from "./payoff";
import { NT_HLINE, CHART_MUTED, CHART_AVG_ENTRY } from "@/ui/palette";
import { loadEcharts } from "@/utils/loadEcharts";

const LINE_COLOR = NT_HLINE;

interface PayoffChartProps {
  legs: PayoffLeg[];
  spot: number | null;
  height?: number;
  /** Spot range shown on either side of spot (default 8%). */
  rangePct?: number;
  "data-testid"?: string;
}

function formatINR(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${Math.abs(value).toFixed(2)}`;
}

export function PayoffChart(props: PayoffChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const height = () => props.height ?? 140;
  const rangePct = () => props.rangePct ?? 8;
  const testId = () => props["data-testid"] ?? "payoff-chart";

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const legs = props.legs;
    if (legs.length === 0) return;
    const spot = props.spot;
    const atmFallback = legs[0]?.strike ?? 100;
    const base = spot ?? atmFallback;
    const spots = curveSpots(base, rangePct());
    const curve = payoffCurve(legs, spots);
    const bes = breakevens(legs, spots[0] ?? 0, spots[spots.length - 1] ?? 0);
    const markLineData: Record<string, unknown>[] = [
      { yAxis: 0, lineStyle: { color: CHART_MUTED, type: "dashed" } },
      ...bes.map((be) => ({
        xAxis: be,
        lineStyle: { color: CHART_AVG_ENTRY, type: "dotted" },
        label: { formatter: String(be), fontSize: 10 },
      })),
    ];
    const markPointData =
      spot === null || spot === undefined
        ? []
        : [
            {
              coord: [spot, payoffAtExpiry(legs, spot)],
              symbolSize: 12,
              itemStyle: { color: LINE_COLOR },
            },
          ];
    void applyOption({
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? params[0] : params;
          const value = (point as { value?: [number, number] })?.value;
          if (!value) return "";
          return `Spot ${Number(value[0]).toFixed(1)}<br/>P&amp;L ${formatINR(Number(value[1]))}`;
        },
      },
      grid: { left: 8, right: 40, top: 8, bottom: 20, containLabel: true },
      xAxis: { type: "value", scale: true, name: "Spot", axisLabel: { hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: "value", scale: true, name: "P&L ₹", splitLine: { show: false } },
      series: [
        {
          type: "line",
          showSymbol: false,
          lineStyle: { color: LINE_COLOR, width: 2 },
          itemStyle: { color: LINE_COLOR },
          data: curve.map((p) => [p.spot, p.pnl]),
          markLine: { symbol: "none", data: markLineData },
          markPoint: { data: markPointData },
        },
      ],
    });
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
    <Show when={props.legs.length > 0} fallback={
      <Box
        data-testid={testId()}
        style={{
          height: `${height()}px`,
          width: "100%",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
      >
        <Text size="sm" className="text-fin-text-muted">
          Add a leg to see payoff
        </Text>
      </Box>
    }>
      <div
        ref={(el) => (chartEl = el)}
        data-testid={testId()}
        style={{ height: `${height()}px`, width: "100%" }}
      />
    </Show>
  );
}
