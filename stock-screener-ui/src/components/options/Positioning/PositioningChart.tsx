import { createEffect, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import { formatNumberIN } from "@/utils/ui-helpers";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { loadEcharts } from "@/utils/loadEcharts";
import type { PositioningStrikeRow } from "@/utils/positioning";

interface PositioningChartProps {
  rows: PositioningStrikeRow[];
  height?: number;
  "data-testid"?: string;
}

export function PositioningChart(props: PositioningChartProps) {
  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;
  let resizeObserver: ResizeObserver | undefined;

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const rows = props.rows;
    if (rows.length === 0) return;
    const strikes = rows.map((r) => String(r.strike));
    const values = rows.map((r) => r.net_cr ?? 0);
    void applyOption({
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
    });
  });

  onMount(() => {
    if (typeof ResizeObserver !== "undefined" && chartEl) {
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(chartEl);
    }
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    resizeObserver?.disconnect();
    chart?.dispose();
    chart = undefined;
  });

  return (
    <div
      ref={(el) => (chartEl = el)}
      data-testid={props["data-testid"] ?? "positioning-chart"}
      style={{ height: `${props.height ?? 320}px`, width: "100%" }}
    />
  );
}
