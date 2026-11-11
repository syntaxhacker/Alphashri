import { useEffect } from "react";
import { Box, Text } from "@/ui";
import { useECharts } from "../../../hooks/useECharts";
import {
  breakevens,
  curveSpots,
  payoffAtExpiry,
  payoffCurve,
  type PayoffLeg,
} from "./payoff";
import { NT_HLINE, CHART_MUTED, CHART_AVG_ENTRY } from "@/ui/palette";

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
  return `${sign}\u20B9${Math.abs(value).toFixed(2)}`;
}

export function PayoffChart({
  legs,
  spot,
  height = 140,
  rangePct = 8,
  "data-testid": testId = "payoff-chart",
}: PayoffChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (legs.length === 0) return;
    const atmFallback = legs[0]?.strike ?? 100;
    const base = spot ?? atmFallback;
    const spots = curveSpots(base, rangePct);
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
    void setChartOption({
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
  }, [legs, spot, rangePct]);

  if (legs.length === 0) {
    return (
      <Box
        data-testid={testId}
        style={{
          height,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text size="sm" className="text-fin-text-muted">
          Add a leg to see payoff
        </Text>
      </Box>
    );
  }

  return (
    <div ref={chartRef} data-testid={testId} style={{ height, width: "100%" }} />
  );
}
