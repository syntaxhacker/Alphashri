import { useMemo } from "react";
import { Box, SegmentedControl, Select, Text, Loader, useColorScheme } from "@/ui";
import ReactECharts from "echarts-for-react";
import type { SectorItem } from "../../types/sector";
import type { HeatmapStock } from "../../api/heatmap";
import {
  SECTOR_STOCK_METRICS,
  buildStockTreemapOption,
  type StockTreemapStyle,
  getSignedMetricColor,
} from "../../components/heatmap/stockTreemap";
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

/** Surface-specific look: sector page stock tiles. Shared data/tooltip live in stockTreemap.ts. */
const SECTOR_STOCK_TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: BROWN_DARK,
  borderLight: CREAM,
  label: {
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 13,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowBlur: 2,
  },
  changePositive: TRADING_GREEN,
  changeNegative: TRADING_RED,
};

function buildSectorTreemapOption(sectors: SectorItem[], isDark: boolean) {
  const changes = sectors.map((s) => s.avg_change);
  const minChange = changes.length ? Math.min(...changes) : 0;
  const maxChange = changes.length ? Math.max(...changes) : 1;

  const data = sectors.map((s) => {
    const color = getSignedMetricColor(s.avg_change, minChange, maxChange);
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
      label: { color: CREAM },
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
          color: CREAM,
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 13,
          textShadowColor: "rgba(0, 0, 0, 0.45)",
          textShadowBlur: 2,
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
    return buildStockTreemapOption(stocks, metric, SECTOR_STOCK_METRICS, isDark, SECTOR_STOCK_TREEMAP_STYLE);
  }, [viewMode, sectors, stocks, metric, isDark]);

  return (
    <Box
      data-testid="sector-heatmap-view"
      sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, gap: 0, overflow: "hidden" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1, height: 32, flexShrink: 0, flexWrap: "wrap" }}>
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
              w={130}
              placeholder="Color by"
              value={metric}
              onChange={(v) => onMetricChange(v || "change_pct")}
              data={SECTOR_STOCK_METRICS}
              data-testid="sector-heatmap-metric"
            />
            <Select
              size="xs"
              w={160}
              placeholder="All sectors"
              value={sectorFilter || ""}
              onChange={(v) => onSectorFilterChange?.(v || null)}
              data={[{ value: "", label: "All sectors" }, ...sectorOptions]}
              clearable
              data-testid="sector-heatmap-sector-filter"
            />
          </>
        )}
        {lastUpdated && (
          <Text c="dimmed" sx={{ ml: "auto", fontSize: 9.5 }}>
            Updated: {new Date(lastUpdated).toLocaleTimeString()}
          </Text>
        )}
        {loading && <Loader size="xs" />}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, width: "100%", display: "flex" }} data-testid="sector-heatmap-chart">
        <ReactECharts
          option={chartOption}
          style={{ height: "100%", width: "100%", flex: 1 }}
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

/** Kept for existing consumers: the sector page's stock treemap metric list. */
export { SECTOR_STOCK_METRICS as STOCK_METRICS };
