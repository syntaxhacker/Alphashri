import { useMemo, useRef } from "react";
import { Box, Group, Select, Text, ScrollArea, useColorScheme } from "@/ui";
import ReactECharts from "echarts-for-react";
import type { HeatmapStock } from "../../api/heatmap";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
} from "../../config/colors";
import {
  METRICS,
  getMetricValue,
  getHeatmapMetricColor,
  getHeatmapMetricTextColor,
  isSignedHeatmapMetric,
  formatMarketCap,
  type MetricConfig,
} from "./heatmapUtils";

export interface HeatmapTreemapProps {
  stocks: HeatmapStock[];
  metric: string;
  onMetricChange?: (metric: string) => void;
  metrics?: MetricConfig[];
  showMetricSelect?: boolean;
  showLegend?: boolean;
  chartHeight?: number | string;
  onSymbolClick?: (symbol: string) => void;
  testId?: string;
}

export function HeatmapTreemap({
  stocks,
  metric,
  onMetricChange,
  metrics = METRICS,
  showMetricSelect = false,
  showLegend = true,
  chartHeight = 480,
  onSymbolClick,
  testId = "heatmap-treemap",
}: HeatmapTreemapProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const chartRef = useRef<ReactECharts>(null);

  const activeMetric = metrics.find((m) => m.value === metric) || metrics[0];
  const metricKey = activeMetric.value;

  const metricValues = stocks.map((s) => getMetricValue(s, metricKey));
  const metricMin = metricValues.length ? Math.min(...metricValues) : 0;
  const metricMax = metricValues.length ? Math.max(...metricValues) : 1;

  const chartOption = useMemo(() => {
    const data = stocks.map((stock) => {
      const mv = getMetricValue(stock, metricKey);
      const color = getHeatmapMetricColor(metricKey, mv, metricMin, metricMax);
      const textColor = getHeatmapMetricTextColor(metricKey, mv, metricMin, metricMax);
      const extra = stock as HeatmapStock & Record<string, unknown>;
      return {
        name: stock.symbol,
        value: 1,
        path: stock.symbol,
        nameFull: stock.name,
        sector: stock.sector,
        price: stock.price,
        change: stock.change_pct,
        mcap: stock.market_cap,
        pe: stock.pe_ratio,
        score: extra.score,
        gap52: extra.to_52w_high,
        metricLabel: activeMetric.label,
        metricValue: activeMetric.fmt(mv),
        label: { color: textColor },
        itemStyle: { color },
      };
    });

    const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
    const tooltipBorder = isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER;
    const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;

    return {
      tooltip: {
        trigger: "item",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText },
        formatter: (params: { data?: Record<string, unknown> }) => {
          const d = params.data;
          if (!d) return "";
          const lines = [
            `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.name}</div>`,
            `<div style="color:${tooltipText};font-size:12px;opacity:0.8">${d.nameFull}</div>`,
            `<div style="margin-top:8px">`,
            `  <div style="color:${tooltipText}">${d.metricLabel}: <b>${d.metricValue}</b></div>`,
          ];
          if (d.pe != null && Number(d.pe) > 0) {
            lines.push(`  <div style="color:${tooltipText}">P/E: <b>${d.pe}</b></div>`);
          }
          if (d.mcap != null && Number(d.mcap) > 0) {
            lines.push(`  <div style="color:${tooltipText}">MCap: <b>${formatMarketCap(Number(d.mcap))}</b></div>`);
          }
          if (d.gap52 != null && d.gap52 !== "") {
            lines.push(`  <div style="color:${tooltipText}">52W Gap: <b>${Number(d.gap52).toFixed(2)}%</b></div>`);
          }
          if (d.score != null && d.score !== "") {
            lines.push(`  <div style="color:${tooltipText}">Score: <b>${d.score}</b></div>`);
          }
          if (d.price != null && Number(d.price) > 0) {
            lines.push(`  <div style="color:${tooltipText}">Price: <b>₹${Number(d.price).toFixed(2)}</b></div>`);
          }
          if (d.change != null && d.change !== "") {
            const ch = Number(d.change);
            lines.push(
              `  <div style="color:${ch >= 0 ? "green" : "red"}">Change: <b>${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</b></div>`,
            );
          }
          if (d.sector) {
            lines.push(`  <div style="color:${tooltipText}">Sector: ${d.sector}</div>`);
          }
          lines.push(`</div>`);
          return lines.join("\n");
        },
      },
      series: [
        {
          type: "treemap",
          sort: false,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          roam: false,
          squareRatio: 1,
          label: {
            show: true,
            formatter: (params: { name?: string; data?: { metricValue?: string } }) =>
              `${params.name}\n${params.data?.metricValue ?? ""}`,
            fontSize: 10,
            fontWeight: "bold",
            lineHeight: 14,
            textBorderColor: "#000",
            textBorderWidth: 0.5,
          },
          breadcrumb: { show: false },
          itemStyle: {
            borderColor: isDark ? "#1a1a1a" : "#fff",
            borderWidth: 1,
            gapWidth: 0,
          },
          levels: [
            {
              itemStyle: {
                borderColor: isDark ? "#1a1a1a" : "#fff",
                borderWidth: 0,
                gapWidth: 0,
              },
            },
            {
              colorSaturation: [0.35, 0.5],
              itemStyle: { borderColorSaturation: 0.6, gapWidth: 0, borderWidth: 1 },
            },
          ],
          data,
        },
      ],
    };
  }, [stocks, activeMetric, metricKey, metricMin, metricMax, isDark, metrics]);

  const metricOptions = metrics.map((m) => ({ value: m.value, label: m.label }));

  return (
    <Box data-testid={testId} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {showMetricSelect && onMetricChange && (
        <Group gap="xs" p={6} wrap="nowrap">
          <Select
            size="xs"
            label="Color by"
            value={metricKey}
            onChange={(v) => onMetricChange(v || metrics[0].value)}
            data={metricOptions}
            style={{ width: 140 }}
            data-testid={`${testId}-metric`}
          />
          <Text size="xs" c="dimmed">
            {stocks.length} stocks
          </Text>
        </Group>
      )}
      <ScrollArea style={{ flex: 1 }} type="auto">
        <Box style={{ minHeight: typeof chartHeight === "number" ? chartHeight : undefined, minWidth: 320 }}>
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: chartHeight, width: "100%" }}
            opts={{ renderer: "canvas" }}
            onEvents={
              onSymbolClick
                ? {
                    click: (params: { name?: string }) => {
                      if (params?.name) onSymbolClick(params.name);
                    },
                  }
                : undefined
            }
          />
        </Box>
      </ScrollArea>
      {showLegend && stocks.length > 0 && (
        <Box
          data-testid={`${testId}-legend`}
          p={6}
          style={{ borderTop: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}
        >
          <Group gap="md" wrap="wrap">
            <Text size="xs" fw={600}>
              {activeMetric.label}
            </Text>
            <Group gap={4}>
              <Box
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: getHeatmapMetricColor(metricKey, metricMin, metricMin, metricMax),
                  borderRadius: 2,
                }}
              />
              <Text size="xs">{activeMetric.fmt(metricMin)}</Text>
            </Group>
            <Box
              style={{
                flex: 1,
                maxWidth: 120,
                height: 8,
                borderRadius: 4,
                background: isSignedHeatmapMetric(metricKey)
                  ? "linear-gradient(to right, rgb(175,35,35), rgb(245,230,60), rgb(80,185,70))"
                  : "linear-gradient(to right, rgb(0,90,30), rgb(80,185,70), rgb(245,230,60), rgb(235,130,40), rgb(175,35,35))",
              }}
            />
            <Group gap={4}>
              <Box
                style={{
                  width: 12,
                  height: 12,
                  backgroundColor: getHeatmapMetricColor(metricKey, metricMax, metricMin, metricMax),
                  borderRadius: 2,
                }}
              />
              <Text size="xs">{activeMetric.fmt(metricMax)}</Text>
            </Group>
          </Group>
        </Box>
      )}
    </Box>
  );
}