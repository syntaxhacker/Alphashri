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

const LINE_COLOR = "#38BDF8";

interface PayoffChartProps {
  legs: PayoffLeg[];
  spot: number | null;
  height?: number;
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
  "data-testid": testId = "payoff-chart",
}: PayoffChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (legs.length === 0) return;
    const atmFallback = legs[0]?.strike ?? 100;
    const base = spot ?? atmFallback;
    const spots = curveSpots(base);
    const curve = payoffCurve(legs, spots);
    const bes = breakevens(legs, spots[0] ?? 0, spots[spots.length - 1] ?? 0);
    const markLineData: Record<string, unknown>[] = [
      { yAxis: 0, lineStyle: { color: "#94A3B8", type: "dashed" } },
      ...bes.map((be) => ({
        xAxis: be,
        lineStyle: { color: "#F59E0B", type: "dotted" },
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
              itemStyle: { color: "#38BDF8" },
            },
          ];
    void setChartOption({
      animation: false,
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
      xAxis: { type: "value", scale: true, name: "Spot", axisLabel: { hideOverlap: true } },
      yAxis: { type: "value", scale: true, name: "P&L ₹" },
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
  }, [legs, spot]);

  if (legs.length === 0) {
    return (
      <Box
        data-testid={testId}
        sx={{
          height,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text size="sm" c="dimmed">
          Add a leg to see payoff
        </Text>
      </Box>
    );
  }

  return (
    <Box
      ref={chartRef}
      data-testid={testId}
      sx={{ height, width: "100%" }}
    />
  );
}
