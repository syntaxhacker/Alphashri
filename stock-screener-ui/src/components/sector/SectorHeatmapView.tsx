import { useMemo } from "react";
import { Box, Group, SegmentedControl, Select, Text, Loader, useColorScheme } from "@/ui";
import ReactECharts from "echarts-for-react";
import type { SectorItem } from "../../types/sector";
import type { HeatmapStock } from "../../api/heatmap";
import { getHeatmapMetricColor, getHeatmapMetricTextColor, getMetricValue, formatMarketCap } from "../../pages/heatmap/heatmapUtils";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
  TRADING_GREEN,
  TRADING_RED,
  CREAM,
  BROWN_DARK,
  BLACK,
  SECTOR_GREEN,
  SECTOR_RED,
} from "../../config/colors";
import { formatPercentage } from "../../utils/ui-helpers";

export type ViewMode = "sector" | "stock";

interface SectorHeatmapViewProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  sectors: SectorItem[];
  stocks: HeatmapStock[];
  metric: string;
  onMetricChange: (metric: string) => void;
  sectorFilter?: string | null;
  sectorOptions?: { value: string; label: string }[];
  onSectorFilterChange?: (sector: string | null) => void;
  lastUpdated?: string;
  loading?: boolean;
  onSymbolClick?: (symbol: string) => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const int = parseInt(h, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

const STOCK_METRICS = [
  { value: "change_pct", label: "Day Change %" },
  { value: "market_cap", label: "Market Cap" },
  { value: "pe_ratio", label: "P/E Ratio" },
  { value: "pb_ratio", label: "P/B Ratio" },
  { value: "dividend_yield", label: "Div Yield" },
  { value: "perf_1y", label: "1Y Return" },
  { value: "roe", label: "ROE" },
];

const COLOR_STOPS: [number, [number, number, number]][] = [
  [0, hexToRgb(TRADING_GREEN)],
  [25, hexToRgb(SECTOR_GREEN)],
  [50, hexToRgb(CREAM)],
  [75, hexToRgb(SECTOR_RED)],
  [100, hexToRgb(TRADING_RED)],
];

function lerpRgb(t: number): string {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const [p1, rgb1] = COLOR_STOPS[i];
    const [p2, rgb2] = COLOR_STOPS[i + 1];
    if (t >= p1 && t <= p2) {
      const p = (t - p1) / (p2 - p1);
      const r = Math.round(rgb1[0] + p * (rgb2[0] - rgb1[0]));
      const g = Math.round(rgb1[1] + p * (rgb2[1] - rgb1[1]));
      const b = Math.round(rgb1[2] + p * (rgb2[2] - rgb1[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return `rgb(${hexToRgb(TRADING_RED).join(",")})`;
}

function getSectorHeatmapColor(value: number, min: number, max: number): string {
  if (value > 0) {
    const t = max > 0 ? Math.min(value / max, 1) : 1;
    return lerpRgb(25 * t);
  }
  if (value < 0) {
    const t = min < 0 ? Math.min(Math.abs(value) / Math.abs(min), 1) : 1;
    return lerpRgb(75 + 25 * t);
  }
  return lerpRgb(50);
}

const TEXT_COLOR_DARK = BROWN_DARK;
const TEXT_COLOR_LIGHT = CREAM;

function getTextColorForBg(bg: string): string {
  const m = bg.match(/\d+/g);
  if (!m) return TEXT_COLOR_LIGHT;
  const l = (0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2]) / 255;
  return l > 0.55 ? TEXT_COLOR_DARK : TEXT_COLOR_LIGHT;
}

function buildSectorTreemapOption(sectors: SectorItem[], isDark: boolean) {
  const changes = sectors.map((s) => s.avg_change);
  const minChange = changes.length ? Math.min(...changes) : 0;
  const maxChange = changes.length ? Math.max(...changes) : 1;

  const data = sectors.map((s) => {
    const color = getSectorHeatmapColor(s.avg_change, minChange, maxChange);
    const textColor = getTextColorForBg(color);
    return {
      name: s.sector,
      value: Math.max(s.stock_count, 1),
      avg_change: s.avg_change,
      stock_count: s.stock_count,
      advances: s.advances,
      declines: s.declines,
      avg_rsi: s.avg_rsi,
      avg_adx: s.avg_adx,
      top_movers: s.top_movers,
      label: { color: textColor },
      itemStyle: { color },
    };
  });

  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipBorder = isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;

  return {
    tooltip: {
      trigger: "item" as const,
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText },
      formatter: (params: { data?: Record<string, unknown> }) => {
        const d = params.data;
        if (!d) return "";
        const lines = [
          `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.name}</div>`,
          `<div style="margin-top:6px">`,
          `  <div style="color:${tooltipText}">Avg Change: <b>${formatPercentage(Number(d.avg_change))}</b></div>`,
          `  <div style="color:${tooltipText}">Stocks: <b>${d.stock_count}</b></div>`,
          `  <div style="color:${tooltipText}">Advances: <b style="color:${TRADING_GREEN}">${d.advances}</b> / Declines: <b style="color:${TRADING_RED}">${d.declines}</b></div>`,
        ];
        if (d.avg_rsi != null && Number(d.avg_rsi) > 0) {
          lines.push(`  <div style="color:${tooltipText}">Avg RSI: <b>${Number(d.avg_rsi).toFixed(1)}</b></div>`);
        }
        if (d.avg_adx != null && Number(d.avg_adx) > 0) {
          lines.push(`  <div style="color:${tooltipText}">Avg ADX: <b>${Number(d.avg_adx).toFixed(1)}</b></div>`);
        }
        if (d.top_movers) {
          lines.push(`  <div style="color:${tooltipText};margin-top:4px;font-size:11px;opacity:0.8">Top: ${d.top_movers}</div>`);
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
          formatter: (params: { name?: string; data?: { avg_change?: number } }) =>
            `${params.name}\n${params.data?.avg_change != null ? formatPercentage(params.data.avg_change, 2, false) : ""}`,
          fontSize: 10,
          fontWeight: "bold",
          lineHeight: 14,
          textBorderColor: BLACK,
          textBorderWidth: 0.5,
        },
        breadcrumb: { show: false },
        itemStyle: {
          borderColor: isDark ? BROWN_DARK : CREAM,
          borderWidth: 1,
          gapWidth: 0,
        },
        levels: [
          {
            itemStyle: {
              borderColor: isDark ? BROWN_DARK : CREAM,
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
}

function buildStockTreemapOption(stocks: HeatmapStock[], metric: string, isDark: boolean) {
  const metricValues = stocks.map((s) => getMetricValue(s, metric));
  const metricMin = metricValues.length ? Math.min(...metricValues) : 0;
  const metricMax = metricValues.length ? Math.max(...metricValues) : 1;
  const activeMetric = STOCK_METRICS.find((m) => m.value === metric) || STOCK_METRICS[0];

  const data = stocks.map((stock) => {
    const mv = getMetricValue(stock, metric);
    const color = getHeatmapMetricColor(metric, mv, metricMin, metricMax);
    const textColor = getHeatmapMetricTextColor(metric, mv, metricMin, metricMax);
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
      trigger: "item" as const,
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
          lines.push(`  <div style="color:${ch >= 0 ? TRADING_GREEN : TRADING_RED}">Change: <b>${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</b></div>`);
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
          textBorderColor: BLACK,
          textBorderWidth: 0.5,
        },
        breadcrumb: { show: false },
        itemStyle: {
          borderColor: isDark ? BROWN_DARK : CREAM,
          borderWidth: 1,
          gapWidth: 0,
        },
        levels: [
          {
            itemStyle: {
              borderColor: isDark ? BROWN_DARK : CREAM,
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
}

export function SectorHeatmapView({
  viewMode,
  onViewModeChange,
  sectors,
  stocks,
  metric,
  onMetricChange,
  sectorFilter,
  sectorOptions = [],
  onSectorFilterChange,
  lastUpdated,
  loading,
  onSymbolClick,
}: SectorHeatmapViewProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const chartOption = useMemo(() => {
    if (viewMode === "sector") {
      return buildSectorTreemapOption(sectors, isDark);
    }
    return buildStockTreemapOption(stocks, metric, isDark);
  }, [viewMode, sectors, stocks, metric, isDark]);

  return (
    <Box
      data-testid="sector-heatmap-view"
      sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, p: 1, gap: 1, alignItems: "center" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%", flexWrap: "wrap" }}>
        <SegmentedControl
          size="xs"
          value={viewMode}
          onChange={(v) => onViewModeChange(v as ViewMode)}
          data={[
            { label: "Sectors", value: "sector" },
            { label: "Stocks", value: "stock" },
          ]}
          data-testid="sector-heatmap-view-toggle"
        />
        {viewMode === "stock" && (
          <>
            <Select
              size="xs"
              placeholder="Color by"
              value={metric}
              onChange={(v) => onMetricChange(v || "change_pct")}
              data={STOCK_METRICS}
              sx={{ width: 130 }}
              data-testid="sector-heatmap-metric"
            />
            <Select
              size="xs"
              placeholder="All sectors"
              value={sectorFilter || ""}
              onChange={(v) => onSectorFilterChange?.(v || null)}
              data={[{ value: "", label: "All sectors" }, ...sectorOptions]}
              clearable
              sx={{ width: 160 }}
              data-testid="sector-heatmap-sector-filter"
            />
          </>
        )}
        {lastUpdated && (
          <Text size="xs" c="dimmed" sx={{ ml: "auto" }}>
            Updated: {new Date(lastUpdated).toLocaleTimeString()}
          </Text>
        )}
        {loading && <Loader size="xs" />}
      </Box>
      <Box sx={{ flex: 1, minHeight: 320, width: "100%", minWidth: 320, display: "flex", alignItems: "center", justifyContent: "center" }} data-testid="sector-heatmap-chart">
        <ReactECharts
          option={chartOption}
          style={{ height: 420, width: "100%", flex: 1 }}
          opts={{ renderer: "canvas" }}
          onEvents={
            onSymbolClick && viewMode === "stock"
              ? {
                  click: (params: { name?: string }) => {
                    if (params?.name) onSymbolClick(params.name);
                  },
                }
              : undefined
          }
        />
      </Box>
    </Box>
  );
}

export { STOCK_METRICS };
