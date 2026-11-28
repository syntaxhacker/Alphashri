import { createMemo } from "solid-js";
import { formatNumberIN } from "@/utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { PositioningStrikeRow } from "@/utils/positioning";
import { EChartsHost } from "../../charts/EChartsHost";

interface PositioningChartProps {
  rows: PositioningStrikeRow[];
  height?: number;
  "data-testid"?: string;
}

export function PositioningChart(props: PositioningChartProps) {
  const option = createMemo<Record<string, unknown> | undefined>(() => {
    const rows = props.rows;
    if (rows.length === 0) return undefined;
    const strikes = rows.map((r) => String(r.strike));
    const values = rows.map((r) => r.net_cr ?? 0);
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params[0] : params;
          const v = (p as { value?: number; name?: string })?.value;
          if (v === undefined || v === null) return "";
          const sign = v < 0 ? "-" : "";
          const abs = formatNumberIN(Math.abs(Math.round(v)));
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
    };
  });

  return (
    <EChartsHost
      option={option}
      data-testid={props["data-testid"] ?? "positioning-chart"}
      style={{ height: `${props.height ?? 320}px`, width: "100%" }}
    />
  );
}
