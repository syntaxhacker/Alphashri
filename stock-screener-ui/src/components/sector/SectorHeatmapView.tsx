import { createEffect, createMemo, onCleanup, Show } from "solid-js";
import type * as ECharts from "echarts";
import { Box, SegmentedControl, Select, Text, Loader, useColorScheme } from "@/ui";
import { loadEcharts } from "@/utils/loadEcharts";
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

export function SectorHeatmapView(props: SectorHeatmapViewProps) {
  const { isDark } = useColorScheme();

  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const option = createMemo(() => {
    if (props.viewMode === "sector") {
      return buildSectorTreemapOption(props.sectors, isDark());
    }
    return buildStockTreemapOption(
      props.stocks,
      props.metric,
      SECTOR_STOCK_METRICS,
      isDark(),
      SECTOR_STOCK_TREEMAP_STYLE,
    );
  });

  async function applyOption(next: ReturnType<typeof option>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) {
      chart = lib.init(chartEl, null, { renderer: "canvas" }) as ECharts.ECharts;
      chart.on("click", (params: unknown) => {
        const p = params as { name?: string };
        if (props.onSymbolClick && props.viewMode === "stock" && p?.name) {
          props.onSymbolClick(p.name);
        }
      });
    }
    chart.setOption(next as Record<string, unknown>, true);
    chart.resize();
  }

  createEffect(() => {
    void applyOption(option());
  });

  createEffect(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = undefined;
  });

  const sectorFilterValue = () => props.sectorFilter ?? "";

  return (
    <Box
      data-testid="sector-heatmap-view"
      className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <Box className="flex items-center gap-2 px-2 h-8 shrink-0 flex-wrap">
        <SegmentedControl
          size="xs"
          value={props.viewMode}
          onChange={(v) => props.onViewModeChange(v as ViewMode)}
          data={[
            { label: "Sectors", value: "sector" },
            { label: "Stocks", value: "stock" },
          ]}
          data-testid="sector-heatmap-view-toggle"
        />
        <Show when={props.viewMode === "stock"}>
          <Select
            size="xs"
            w={130}
            placeholder="Color by"
            value={props.metric}
            onChange={(v) => props.onMetricChange(v || "change_pct")}
            data={SECTOR_STOCK_METRICS}
            data-testid="sector-heatmap-metric"
          />
          <Select
            size="xs"
            w={160}
            placeholder="All sectors"
            value={sectorFilterValue()}
            onChange={(v) => props.onSectorFilterChange?.(v || null)}
            data={[{ value: "", label: "All sectors" }, ...(props.sectorOptions ?? [])]}
            clearable
            data-testid="sector-heatmap-sector-filter"
          />
        </Show>
        <Show when={props.lastUpdated}>
          <Text c="dimmed" className="ml-auto text-[9.5px] font-mono tabular-nums">
            Updated: {new Date(props.lastUpdated!).toLocaleTimeString()}
          </Text>
        </Show>
        <Show when={props.loading}>
          <Loader size="xs" />
        </Show>
      </Box>
      <Box className="flex min-h-0 w-full flex-1" data-testid="sector-heatmap-chart">
        <div ref={(el) => (chartEl = el)} class="h-full w-full" style={{ "min-width": 0 }} />
      </Box>
    </Box>
  );
}

/** Kept for existing consumers: the sector page's stock treemap metric list. */
export { SECTOR_STOCK_METRICS as STOCK_METRICS };
