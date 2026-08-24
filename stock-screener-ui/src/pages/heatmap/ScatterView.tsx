import { Box, Stack } from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { HeatmapStock } from "../../api/heatmap";
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

export function ScatterView({ stocks, metricX, metricY, onMetricXChange, onMetricYChange, getMetricValue, METRICS }: ScatterViewProps) {
  const isDark = document.documentElement.getAttribute('data-dark') === 'true';
  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;
  const axisLineColor = isDark ? AXIS_DARK_LINE : AXIS_LIGHT_LINE;
  const splitLineColor = isDark ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT;

  const { sectors, sectorColors } = useMemo(() => {
    const unique = [...new Set(stocks.map(s => s.sector).filter(Boolean))];
    const colors: Record<string, string> = {};
    unique.forEach((s, i) => { colors[s] = PALETTE[i % PALETTE.length]; });
    return { sectors: unique, sectorColors: colors };
  }, [stocks]);

  const metricXLabel = METRICS.find(m => m.value === metricX)?.label || metricX;
  const metricYLabel = METRICS.find(m => m.value === metricY)?.label || metricY;

  const option = useMemo(() => {
    const series = sectors.map(sector => {
      const sectorStocks = stocks.filter(s => s.sector === sector);
      return {
        name: sector,
        type: 'scatter',
        data: sectorStocks.map(s => ({
          value: [getMetricValue(s, metricX), getMetricValue(s, metricY)],
          symbol: s.symbol,
          sector: s.sector,
        })),
        itemStyle: { color: sectorColors[sector] },
        emphasis: {
          label: {
            show: true,
            formatter: (params: any) => params.data?.symbol || '',
            position: 'top',
            fontSize: 11,
            fontWeight: 'bold',
            color: tooltipText,
          },
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const d = params.data;
          if (!d) return '';
          const xVal = METRICS.find(m => m.value === metricX)?.fmt(d.value[0]) ?? d.value[0];
          const yVal = METRICS.find(m => m.value === metricY)?.fmt(d.value[1]) ?? d.value[1];
          return [
            `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.symbol}</div>`,
            `<div style="color:${tooltipText};font-size:12px;margin-top:4px">Sector: ${d.sector}</div>`,
            `<div style="margin-top:8px">`,
            `  <div style="color:${tooltipText}">${metricXLabel}: <b>${xVal}</b></div>`,
            `  <div style="color:${tooltipText}">${metricYLabel}: <b>${yVal}</b></div>`,
            `</div>`,
          ].join('\n');
        },
        backgroundColor: tooltipBg,
        borderColor: isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText },
      },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 10,
        top: 40,
        textStyle: { color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT, fontSize: 10 },
        pageTextStyle: { color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
      },
      grid: {
        left: 50,
        right: 130,
        bottom: 50,
        top: 10,
      },
      xAxis: {
        type: 'value',
        name: metricXLabel,
        nameLocation: 'center',
        nameGap: 30,
        nameTextStyle: { fontSize: 12, fontWeight: 'bold', color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      yAxis: {
        type: 'value',
        name: metricYLabel,
        nameLocation: 'center',
        nameGap: 40,
        nameTextStyle: { fontSize: 12, fontWeight: 'bold', color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      series,
    };
  }, [stocks, sectors, sectorColors, metricX, metricY, metricXLabel, metricYLabel, getMetricValue, isDark, tooltipBg, tooltipText]);

  const metricOptions = METRICS.map(m => ({ value: m.value, label: m.label }));

  return (
    <Stack spacing={1} sx={{ height: "100%", flex: 1, p: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Card elevation={1} sx={{ width: "100%", p: 1 }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", flexWrap: "wrap" }}>
            <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>X Axis</Typography>
            <Select size="small" value={metricX} onChange={(e) => onMetricXChange(String(e.target.value) || metricX)} sx={{ minWidth: 140 }}>
              {metricOptions.map((o) => (<MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>))}
            </Select>
            <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Y Axis</Typography>
            <Select size="small" value={metricY} onChange={(e) => onMetricYChange(String(e.target.value) || metricY)} sx={{ minWidth: 140 }}>
              {metricOptions.map((o) => (<MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>))}
            </Select>
          </Box>
        </CardContent>
      </Card>
      <Card elevation={1} sx={{ width: "100%", flex: 1, p: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ flex: 1, minHeight: 320, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
            <ReactECharts option={option} style={{ height: "100%", width: "100%" }} opts={{ renderer: "canvas" }} />
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
