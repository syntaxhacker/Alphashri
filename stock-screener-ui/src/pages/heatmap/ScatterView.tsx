import { Box, Stack, Text } from "@/ui";
import { Select } from "@/ui";
import { createMemo } from "solid-js";
import type { HeatmapStock } from "../../api/heatmap";
import { EChart } from "./EChart";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
  AXIS_DARK_LINE,
  AXIS_LIGHT_LINE,
  AXIS_DARK_SPLIT,
  AXIS_LIGHT_SPLIT,
  CREAM,
  TRADING_GREEN,
  TEXT_MUTED,
  TRADING_RED,
  SECTOR_GREEN,
  SECTOR_RED,
  BROWN,
  BROWN_DARK,
  SURFACE_ALT,
} from "../../config/colors";

interface ScatterViewProps {
  stocks: HeatmapStock[];
  metricX: string;
  metricY: string;
  onMetricXChange: (v: string) => void;
  onMetricYChange: (v: string) => void;
  getMetricValue: (stock: HeatmapStock, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

const PALETTE = [CREAM, TRADING_GREEN, TEXT_MUTED, TRADING_RED, SECTOR_GREEN, SECTOR_RED, BROWN, BROWN_DARK, SURFACE_ALT];

export function ScatterView(props: ScatterViewProps) {
  const isDark = () => typeof document !== "undefined" && document.documentElement.getAttribute("data-dark") === "true";
  const tooltipBg = () => (isDark() ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG);
  const tooltipText = () => (isDark() ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT);
  const axisLineColor = () => (isDark() ? AXIS_DARK_LINE : AXIS_LIGHT_LINE);
  const splitLineColor = () => (isDark() ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT);

  const stocks = () => props.stocks;

  const sectorInfo = createMemo(() => {
    const unique = [...new Set(stocks().map((s) => s.sector).filter(Boolean))];
    const colors: Record<string, string> = {};
    unique.forEach((s, i) => {
      colors[s as string] = PALETTE[i % PALETTE.length];
    });
    return { sectors: unique, sectorColors: colors };
  });

  const metricXLabel = () => props.METRICS.find((m) => m.value === props.metricX)?.label || props.metricX;
  const metricYLabel = () => props.METRICS.find((m) => m.value === props.metricY)?.label || props.metricY;

  const option = createMemo(() => {
    const info = sectorInfo();
    const series = info.sectors.map((sector) => {
      const sectorStocks = stocks().filter((s) => s.sector === sector);
      return {
        name: sector,
        type: "scatter",
        data: sectorStocks.map((s) => ({
          value: [props.getMetricValue(s, props.metricX), props.getMetricValue(s, props.metricY)],
          symbol: s.symbol,
          sector: s.sector,
        })),
        itemStyle: { color: info.sectorColors[sector as string] },
        emphasis: {
          label: {
            show: true,
            formatter: (params: any) => params.data?.symbol || "",
            position: "top",
            fontSize: 11,
            fontWeight: "bold",
            color: tooltipText(),
          },
        },
      };
    });

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (params: any) => {
          const d = params.data;
          if (!d) return "";
          const xVal = props.METRICS.find((m) => m.value === props.metricX)?.fmt(d.value[0]) ?? d.value[0];
          const yVal = props.METRICS.find((m) => m.value === props.metricY)?.fmt(d.value[1]) ?? d.value[1];
          return [
            `<div style="font-weight:bold;font-size:14px;color:${tooltipText()}">${d.symbol}</div>`,
            `<div style="color:${tooltipText()};font-size:12px;margin-top:4px">Sector: ${d.sector}</div>`,
            `<div style="margin-top:8px">`,
            `  <div style="color:${tooltipText()}">${metricXLabel()}: <b>${xVal}</b></div>`,
            `  <div style="color:${tooltipText()}">${metricYLabel()}: <b>${yVal}</b></div>`,
            `</div>`,
          ].join("\n");
        },
        backgroundColor: tooltipBg(),
        borderColor: isDark() ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText() },
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 10,
        top: 40,
        textStyle: { color: tooltipText(), fontSize: 10 },
        pageTextStyle: { color: tooltipText() },
      },
      grid: {
        left: 50,
        right: 130,
        bottom: 50,
        top: 10,
      },
      xAxis: {
        type: "value",
        name: metricXLabel(),
        nameLocation: "center",
        nameGap: 30,
        nameTextStyle: { fontSize: 12, fontWeight: "bold", color: tooltipText() },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: axisLineColor() } },
        splitLine: { lineStyle: { color: splitLineColor() } },
      },
      yAxis: {
        type: "value",
        name: metricYLabel(),
        nameLocation: "center",
        nameGap: 40,
        nameTextStyle: { fontSize: 12, fontWeight: "bold", color: tooltipText() },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: axisLineColor() } },
        splitLine: { lineStyle: { color: splitLineColor() } },
      },
      series,
    };
  });

  const metricOptions = () => props.METRICS.map((m) => ({ value: m.value, label: m.label }));

  return (
    <Stack spacing={0} className="h-full flex-1 min-h-0 w-full overflow-hidden">
      <Box className="flex items-center gap-2 px-2 h-10 flex-shrink-0 border-b border-fin-border flex-wrap">
        <Text size="xs" c="dimmed">X Axis</Text>
        <Select
          size="small"
          value={props.metricX}
          onChange={(v) => props.onMetricXChange(v ?? props.metricX)}
          data={metricOptions()}
          className="min-w-[140px]"
        />
        <Text size="xs" c="dimmed">Y Axis</Text>
        <Select
          size="small"
          value={props.metricY}
          onChange={(v) => props.onMetricYChange(v ?? props.metricY)}
          data={metricOptions()}
          className="min-w-[140px]"
        />
      </Box>
      <Box className="flex-1 min-h-[320px] w-full flex p-2">
        <EChart option={option()} />
      </Box>
    </Stack>
  );
}
