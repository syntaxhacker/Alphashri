import { Box, Stack, Text } from "@/ui";
import { alpha } from "@/ui";
import { createMemo } from "solid-js";
import { TOOLTIP_DARK_BG, TOOLTIP_LIGHT_BG, TOOLTIP_DARK_BORDER, TOOLTIP_LIGHT_BORDER, TOOLTIP_DARK_TEXT, TOOLTIP_LIGHT_TEXT, AXIS_DARK_LINE, AXIS_LIGHT_LINE, AXIS_DARK_SPLIT, AXIS_LIGHT_SPLIT, BLACK } from "../../config/colors";
import { EChart } from "./EChart";

interface SectorBarViewProps {
  stocks: { sector: string; [key: string]: any }[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function SectorBarView(props: SectorBarViewProps) {
  const isDark = () => typeof document !== "undefined" && document.documentElement.getAttribute("data-dark") === "true";
  const tooltipBg = () => (isDark() ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG);
  const tooltipText = () => (isDark() ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT);
  const axisLineColor = () => (isDark() ? AXIS_DARK_LINE : AXIS_LIGHT_LINE);
  const splitLineColor = () => (isDark() ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT);

  const stocks = () => props.stocks;
  const metric = () => props.metric;
  const metricConfig = () => props.METRICS.find((m) => m.value === metric());
  const fmt = () => metricConfig()?.fmt ?? ((v: number) => v.toFixed(2));
  const label = () => metricConfig()?.label ?? metric();

  const option = createMemo(() => {
    const groupMap: Record<string, { sum: number; count: number }> = {};
    for (const stock of stocks()) {
      const sector = stock.sector;
      if (!sector) continue;
      const v = props.getMetricValue(stock, metric());
      if (v === null || v === undefined || !isFinite(v)) continue;
      if (!groupMap[sector]) groupMap[sector] = { sum: 0, count: 0 };
      groupMap[sector].sum += v;
      groupMap[sector].count++;
    }

    const entries = Object.entries(groupMap).map(([sector, { sum, count }]) => ({
      sector,
      avg: sum / count,
      count,
    }));

    if (entries.length === 0) return {};

    entries.sort((a, b) => b.avg - a.avg);

    const minAvg = entries[entries.length - 1].avg;
    const maxAvg = entries[0].avg;

    return {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        "background-color": tooltipBg(),
        "border-color": isDark() ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText() },
        formatter: (params: any) => {
          const d = params[0];
          if (!d) return "";
          const entry = entries[d.dataIndex];
          return [
            `<div style="color:${tooltipText()};font-size:13px;font-weight:bold">${entry.sector}</div>`,
            `<div style="color:${tooltipText()};margin-top:4px">Avg ${label()}: <b>${fmt()(entry.avg)}</b></div>`,
            `<div style="color:${tooltipText()};margin-top:2px">Stocks: <b>${entry.count}</b></div>`,
          ].join("\n");
        },
      },
      grid: { left: 110, right: 60, bottom: 20, top: 40 },
      xAxis: {
        type: "value",
        name: label(),
        nameTextStyle: { "font-size": 11, color: tooltipText() },
        axisLabel: {
          "font-size": 10,
          color: tooltipText(),
          formatter: (v: number) => fmt()(v),
        },
        axisLine: { lineStyle: { color: axisLineColor() } },
        splitLine: { lineStyle: { color: splitLineColor() } },
      },
      yAxis: {
        type: "category",
        data: entries.map((e) => e.sector),
        axisLabel: { "font-size": 10, color: tooltipText() },
        axisLine: { lineStyle: { color: axisLineColor() } },
        splitLine: { show: false },
      },
      series: [
        {
          type: "bar",
          data: entries.map((e) => ({
            value: e.avg,
            itemStyle: { color: props.getMetricColor(e.avg, minAvg, maxAvg) },
          })),
          barMaxWidth: 28,
          emphasis: { itemStyle: { shadowBlur: 4, shadowColor: alpha(BLACK, 0.3) } },
          label: {
            show: true,
            position: "right",
            "font-size": 10,
            color: tooltipText(),
            formatter: (p: any) => fmt()(p.value),
          },
        },
      ],
    };
  });

  return (
    <Stack spacing={0} className="h-full flex-1 min-h-0 w-full overflow-hidden">
      <Box className="flex items-center gap-2 px-2 h-10 flex-shrink-0 border-b border-fin-border">
        <Text size="sm" fw={600}>Avg {label()} by Sector</Text>
        <Text size="xs" c="dimmed">({stocks().length} stocks)</Text>
      </Box>
      <Box className="flex-1 min-h-[320px] w-full flex p-2">
        <EChart option={option()} />
      </Box>
    </Stack>
  );
}
