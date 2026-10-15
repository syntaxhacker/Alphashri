import { useEffect } from "react";
import Box from "@mui/material/Box";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { useECharts } from "../../../hooks/useECharts";
import type { PositioningStrikeRow } from "@/utils/positioning";

interface PositioningChartProps {
  rows: PositioningStrikeRow[];
  height?: number;
  "data-testid"?: string;
}

export function PositioningChart({
  rows,
  height = 320,
  "data-testid": testId = "positioning-chart",
}: PositioningChartProps) {
  const { chartRef, setChartOption } = useECharts({ isDark: true });

  useEffect(() => {
    if (rows.length === 0) return;
    const strikes = rows.map((r) => String(r.strike));
    const values = rows.map((r) => r.net_cr ?? 0);
    void setChartOption({
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const v = (p as { value?: number; name?: string })?.value;
          if (v === undefined || v === null) return "";
          const sign = v < 0 ? "-" : "";
          const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
          const name = (p as { name?: string })?.name ?? "";
          return `Strike ${name}<br/>Net ${sign}${abs} Cr`;
        },
      },
      grid: { left: 8, right: 16, top: 8, bottom: 24, containLabel: true },
      xAxis: { type: "value", scale: true, name: "Net Cr" },
      yAxis: { type: "category", data: strikes, name: "Strike", axisLabel: { hideOverlap: true } },
      series: [
        {
          type: "bar",
          data: values.map((v) => ({
            value: v,
            itemStyle: { color: v < 0 ? NEGATIVE : POSITIVE },
          })),
        },
      ],
    });
  }, [rows, setChartOption]);

  return <Box ref={chartRef} data-testid={testId} sx={{ height, width: "100%" }} />;
}
