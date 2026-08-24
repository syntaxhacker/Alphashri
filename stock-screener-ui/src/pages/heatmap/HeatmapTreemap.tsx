import { useMemo, useRef } from "react";
import { Box, Stack } from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import ReactECharts from "echarts-for-react";
import type { HeatmapStock } from "../../api/heatmap";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
  BG,
  SURFACE,
  CREAM,
  SECTOR_STRONG_GREEN,
  SECTOR_GREEN,
  SECTOR_NEUTRAL,
  SECTOR_RED,
  SECTOR_STRONG_RED,
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
  const isDark = typeof document !== "undefined" ? document.documentElement.getAttribute("data-dark") === "true" : false;
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
            const col = ch >= 0 ? "#16A34A" : "#DC2626";
            lines.push(
              `  <div style="color:${col}">Change: <b>${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</b></div>`,
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
            textBorderColor: BG,
            textBorderWidth: 0.5,
          },
          breadcrumb: { show: false },
          itemStyle: {
            borderColor: isDark ? SURFACE : CREAM,
            borderWidth: 1,
            gapWidth: 0,
          },
          levels: [
            {
              itemStyle: {
                borderColor: isDark ? SURFACE : CREAM,
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

  return (
    <Box data-testid={testId} sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1, flex: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
        {showMetricSelect && onMetricChange && (
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Color by</Typography>
                <Select size="small" value={metricKey} onChange={(e) => onMetricChange(String(e.target.value) || metrics[0].value)} sx={{ minWidth: 140 }} data-testid={`${testId}-metric`}>
                  {metrics.map((m) => (<MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>))}
                </Select>
                <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{stocks.length} stocks</Typography>
              </Box>
            </CardContent>
          </Card>
        )}
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ flex: 1, minHeight: typeof chartHeight === "number" ? chartHeight : undefined, minWidth: 320, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
              <ReactECharts
                ref={chartRef}
                option={chartOption}
                style={{ height: chartHeight, width: "100%", flex: 1 }}
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
          </CardContent>
        </Card>
        {showLegend && stocks.length > 0 && (
          <Card elevation={1} sx={{ width: "100%", p: 1 }}>
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
              <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "center" }}>
                <Grid size={{ xs: 12 }} sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{activeMetric.label}</Typography>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                    <Box sx={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMin, metricMin, metricMax), borderRadius: "2px" }} />
                    <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{activeMetric.fmt(metricMin)}</Typography>
                  </Box>
                  <Box sx={{ flex: 1, maxWidth: 120, height: 8, borderRadius: "4px", background: isSignedHeatmapMetric(metricKey) ? `linear-gradient(to right, ${SECTOR_STRONG_RED}, ${SECTOR_NEUTRAL}, ${SECTOR_GREEN})` : `linear-gradient(to right, ${SECTOR_STRONG_GREEN}, ${SECTOR_GREEN}, ${SECTOR_NEUTRAL}, ${SECTOR_RED}, ${SECTOR_STRONG_RED})`, display: "flex", alignItems: "center", justifyContent: "center" }} />
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                    <Box sx={{ width: 12, height: 12, backgroundColor: getHeatmapMetricColor(metricKey, metricMax, metricMin, metricMax), borderRadius: "2px" }} />
                    <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{activeMetric.fmt(metricMax)}</Typography>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
