import { For, Show, createEffect, createMemo, createUniqueId, onCleanup } from "solid-js";
import type * as ECharts from "echarts";
import { Box, Text, useColorScheme, typeSize } from "@/ui";
import { useMediaQuery } from "@/ui/hooks";
import { pickTextColor } from "@/utils/contrast";
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
  TEXT_ON_ACCENT,
  BG,
} from "../../config/colors";
import { formatSectorPercentage as formatPercentage } from "./sectorUtils";

export type ViewMode = "sector" | "stock";

export interface SectorHeatmapViewProps {
  viewMode: ViewMode;
  sectors: SectorItem[];
  stocks: HeatmapStock[];
  metric: string;
  /** Stock-layer request state; the selector and the chart body share it. */
  loading?: boolean;
  error?: string | null;
  onSymbolClick?: (symbol: string) => void;
}

/** Surface-specific look: sector page stock tiles. Shared data/tooltip live in stockTreemap.ts. */
const SECTOR_STOCK_TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: BROWN_DARK,
  borderLight: CREAM,
  label: {
    fontSize: typeSize("micro"),
    fontWeight: 600,
    lineHeight: 13,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowBlur: 2,
  },
  changePositive: TRADING_GREEN,
  changeNegative: TRADING_RED,
};

/**
 * CREAM misses AA on the ramp's mid green/red stops (4.05 and 4.16:1), so the
 * tile label picks white or the page black per fill instead. Those anchors
 * clear 4.5:1 at every interpolated stop while the fill keeps direction.
 */
export function sectorTileTextColor(fill: string): string {
  return pickTextColor(fill, TEXT_ON_ACCENT, BG);
}

type TileLabelData = {
  itemStyle?: { color?: string };
  label?: { color?: string };
};

/**
 * The shared stock builder uses a luminance heuristic that leaves CREAM on the
 * mid-green stops (~2.9:1). Re-derive every label from its own fill here so the
 * sector page's stock mode reaches the same AA floor as its sector mode.
 */
function withReadableTileInk<T extends { series: { data: TileLabelData[] }[] }>(option: T): T {
  for (const tile of option.series[0]?.data ?? []) {
    const fill = tile.itemStyle?.color;
    if (typeof fill !== "string") continue;
    tile.label = { ...tile.label, color: sectorTileTextColor(fill) };
  }
  return option;
}

/**
 * A treemap tile is only as wide as its stock-count share, so the full NSE
 * sector name cannot survive on a phone. These are direct labels, not a
 * separate legend: the compact map fits the biggest tiles, and the full name
 * stays on the tile tooltip / aria description.
 */
const SECTOR_TILE_NAMES: Record<string, string> = {
  "Technology Services": "Technology",
  "Energy Minerals": "Energy",
  "Non-Energy Minerals": "Non-Energy",
  "Commercial Services": "Commercial",
  "Producer Manufacturing": "Manufacturing",
  "Finance": "Finance",
  "Health Technology": "Health Tech",
  "Industrial Services": "Industrial",
  "Utilities": "Utilities",
  "Distribution Services": "Distribution",
  "Process Industries": "Process",
  "Electronic Technology": "Electronics",
  "Health Services": "Health",
  "Consumer Durables": "Cons. Durables",
  "Communications": "Comms",
  "Consumer Non-Durables": "Cons. Non-Dur.",
  "Transportation": "Transport",
  "Retail Trade": "Retail",
  "Consumer Services": "Cons. Services",
  "Miscellaneous": "Miscellaneous",
};

const SECTOR_TILE_NAMES_COMPACT: Record<string, string> = {
  "Technology Services": "Tech",
  "Energy Minerals": "Energy",
  "Non-Energy Minerals": "Non-En.",
  "Commercial Services": "Comm.",
  "Producer Manufacturing": "Mfg.",
  "Finance": "Finance",
  "Health Technology": "HealthTech",
  "Health Services": "HealthSvcs",
  "Industrial Services": "Indust.",
  "Utilities": "Util.",
  "Distribution Services": "Distrib.",
  "Electronic Technology": "Elec.",
  "Consumer Durables": "Dur.",
  "Communications": "Comms",
  "Consumer Non-Durables": "NonDur",
  "Transportation": "Tran.",
  "Retail Trade": "Retail",
  "Consumer Services": "Cons.",
  "Miscellaneous": "Misc.",
  "Process Industries": "Proc.",
};

export function sectorTileName(name: string, compact: boolean): string {
  return (compact ? SECTOR_TILE_NAMES_COMPACT : SECTOR_TILE_NAMES)[name] ?? name;
}

/** Approximate advance of the 12px UI sans used by treemap labels. */
const TREEMAP_CHAR_PX = 7.6;
const TREEMAP_LABEL_PAD = 14;
const TREEMAP_LABEL_MIN_HEIGHT = 30;

/**
 * The treemap gives the label exactly the tile's content box. Two lines need
 * that box to be both wide enough for the longer line and tall enough for the
 * two 13px rows. Technology/Utilities tiles can be ~37px wide on a phone while
 * still being tall, which is how "Te..." / "Util. / 0...." survived a
 * stock-count-only gate. Decide from the real tile rect instead.
 */
export function treemapLabelFits(
  displayName: string,
  changeLabel: string,
  width: number,
  height: number,
): boolean {
  if (!displayName || width <= 0 || height <= 0) return false;
  const longest = Math.max(displayName.length, changeLabel.length);
  return width >= longest * TREEMAP_CHAR_PX + TREEMAP_LABEL_PAD &&
    height >= TREEMAP_LABEL_MIN_HEIGHT;
}

function buildSectorTreemapOption(sectors: SectorItem[], isDark: boolean, compact = false) {
  const changes = sectors.map((s) => s.avg_change);
  const minChange = changes.length ? Math.min(...changes) : 0;
  const maxChange = changes.length ? Math.max(...changes) : 1;
  const neutralInk = sectorTileTextColor(getSignedMetricColor(0, minChange, maxChange));
  // Tiny tiles get a colour and tooltip but no 2-character label ("Di", "H").
  // On a phone a 12-stock sector can still be a tall 110px tile (Technology),
  // so count is a better visibility floor than area share; squarify can make a
  // 5-stock tile wider than a 12-stock strip. The visible legend below the
  // treemap names every tile that is too small for a direct label.
  const showLabel = (sector: SectorItem): boolean =>
    compact
      ? (sector.stock_count || 0) >= 13 || sector.sector === "Technology Services"
      : (sector.stock_count || 0) >= 5;

  const data = sectors.map((s) => {
    const color = getSignedMetricColor(s.avg_change, minChange, maxChange);
    return {
      name: s.sector,
      displayName: sectorTileName(s.sector, compact),
      value: Math.max(s.stock_count, 1),
      avg_change: s.avg_change,
      stock_count: s.stock_count,
      advances: s.advances,
      declines: s.declines,
      avg_rsi: s.avg_rsi,
      avg_adx: s.avg_adx,
      top_movers: s.top_movers,
      labelBaseShow: showLabel(s),
      label: {
        color: sectorTileTextColor(color),
        show: showLabel(s),
        lineHeight: 13,
      },
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
          `<div style="font-weight:bold;font-size:${typeSize("label")}px;color:${tooltipText}">${d.name}</div>`,
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
          lines.push(`  <div style="color:${tooltipText};margin-top:4px;font-size:${typeSize("micro")}px;opacity:0.8">Top: ${d.top_movers}</div>`);
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
        // ECharts defaults nodeClick to 'zoomToNode'; a click must select the
        // sector, not re-root the chart.
        nodeClick: false,
        squareRatio: 1,
        label: {
          show: true,
          formatter: (params: {
            name?: string;
            data?: { avg_change?: number; displayName?: string };
          }) =>
            `${params.data?.displayName ?? params.name ?? ""}\n${
              params.data?.avg_change != null
                ? formatPercentage(params.data.avg_change, 2, false)
                : ""
            }`,
          color: neutralInk,
          fontSize: typeSize("micro"),
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

interface TreemapNodeLike {
  getModel?: () => { get?: (key: string) => unknown } | undefined;
  getLayout?: () => { width?: number; height?: number } | undefined;
}

interface SectorTreemapDatum {
  name?: string;
  displayName?: string;
  avg_change?: number;
  labelBaseShow?: boolean;
  label?: { show?: boolean; color?: string; lineHeight?: number };
}

function treemapRects(chart: unknown): Map<string, { width: number; height: number }> {
  const rects = new Map<string, { width: number; height: number }>();
  try {
    const model = (chart as { getModel?: () => { getSeriesByIndex?: (index: number) => { getData?: () => { tree?: { root?: { children?: TreemapNodeLike[] } } } } } }).getModel?.();
    const nodes = model?.getSeriesByIndex?.(0)?.getData?.()?.tree?.root?.children ?? [];
    for (const node of nodes) {
      const name = node.getModel?.()?.get?.("name");
      const layout = node.getLayout?.();
      if (typeof name !== "string" || !layout) continue;
      if (typeof layout.width === "number" && typeof layout.height === "number") {
        rects.set(name, { width: layout.width, height: layout.height });
      }
    }
  } catch {
    // A test double or an ECharts upgrade can omit the layout model; the
    // conservative count gate remains a safe fallback.
  }
  return rects;
}

/**
 * ECharts sizes a treemap label to its tile's content box and then truncates
 * with an ellipsis. Re-check the real rects after layout and suppress labels
 * that cannot carry both lines; the legend names every sector anyway.
 */
export function fitTreemapLabelVisibility(chart: unknown, option: unknown): boolean {
  const series = (option as { series?: Array<{ type?: string; data?: SectorTreemapDatum[] }> })
    .series?.[0];
  if (!series || series.type !== "treemap" || !Array.isArray(series.data)) return false;
  const rects = treemapRects(chart);
  if (rects.size === 0) return false;
  let changed = false;
  for (const item of series.data) {
    const rect = item.name ? rects.get(item.name) : undefined;
    if (!rect) continue;
    const changeLabel =
      item.avg_change != null ? formatPercentage(item.avg_change, 2, false) : "";
    const show =
      Boolean(item.labelBaseShow) &&
      treemapLabelFits(String(item.displayName ?? item.name ?? ""), changeLabel, rect.width, rect.height);
    if (item.label?.show !== show) {
      item.label = { ...item.label, show };
      changed = true;
    }
  }
  if (changed) {
    (chart as { setOption?: (option: unknown, opts?: unknown) => void }).setOption?.(
      { series: [{ data: series.data }] },
      { lazyUpdate: false },
    );
  }
  return changed;
}

export function SectorHeatmapView(props: SectorHeatmapViewProps) {
  const { isDark } = useColorScheme();
  const compact = useMediaQuery("(max-width: 900px)", undefined, { noSsr: true });
  const descriptionId = `sector-heatmap-description-${createUniqueId()}`;

  const isSectorMode = () => props.viewMode === "sector";
  const sectorMin = createMemo(() => {
    const values = props.sectors.map((sector) => sector.avg_change);
    return values.length ? Math.min(...values) : 0;
  });
  const sectorMax = createMemo(() => {
    const values = props.sectors.map((sector) => sector.avg_change);
    return values.length ? Math.max(...values) : 1;
  });
  const chartLabel = () =>
    isSectorMode() ? "Sector performance heatmap" : "Stock performance heatmap";
  const stockState = createMemo<"loading" | "error" | "empty" | null>(() => {
    if (isSectorMode()) return null;
    if (props.loading) return "loading";
    if (props.error) return "error";
    if (props.stocks.length === 0) return "empty";
    return null;
  });
  const stockStateMessage = createMemo(() => {
    switch (stockState()) {
      case "loading":
        return "Loading stock heatmap…";
      case "error":
        return "Stock heatmap unavailable. Keep the sector layer or retry the refresh.";
      case "empty":
        return "No stocks match this sector filter.";
      default:
        return "";
    }
  });
  const chartDescription = () => {
    if (isSectorMode()) {
      const count = props.sectors.length;
      return count
        ? `Sector heatmap showing average change and stock count for ${count} sector${count === 1 ? "" : "s"}. Green tiles are positive and red tiles are negative; the same values follow in a text table.`
        : "Sector heatmap with no sector data available.";
    }
    const count = props.stocks.length;
    return count
      ? `Stock heatmap showing ${count} stock${count === 1 ? "" : "s"} coloured by ${props.metric}.`
      : "Stock heatmap with no stock data available.";
  };

  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let appliedOption: ReturnType<typeof option> | undefined;
  let disposed = false;

  const option = createMemo(() =>
    withReadableTileInk(
      props.viewMode === "sector"
        ? buildSectorTreemapOption(props.sectors, isDark(), compact())
        : buildStockTreemapOption(
            props.stocks,
            props.metric,
            SECTOR_STOCK_METRICS,
            isDark(),
            SECTOR_STOCK_TREEMAP_STYLE,
          ),
    ),
  );

  // The canvas itself cannot take focus. A compact, keyboard-operable symbol
  // rail exposes the same chart action; keep it bounded so a 500-row snapshot
  // does not mount 500 buttons on every poll.
  const railSymbols = createMemo(() => {
    if (props.viewMode !== "stock") return [];
    const seen = new Set<string>();
    return [...props.stocks]
      .sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0))
      .map((stock) => stock.symbol)
      .filter((symbol) => {
        const key = String(symbol ?? "").trim().toUpperCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 40);
  });

  const activate = (symbol: string) => props.onSymbolClick?.(symbol);

  async function applyOption(next: ReturnType<typeof option>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) {
      chart = lib.init(chartEl, null, { renderer: "canvas" }) as ECharts.ECharts;
      chart.on("click", (params: unknown) => {
        const p = params as { name?: string };
        if (props.onSymbolClick && props.viewMode === "stock" && p?.name) {
          activate(p.name);
        }
      });
    }
    chart.setOption(next as Record<string, unknown>, true);
    chart.resize();
    appliedOption = next;
    // Treemap nodes receive their final rects during the render step, not in
    // the setOption call itself. Measure on the next frame, then hide labels
    // that cannot carry their two lines.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (!disposed && chart && appliedOption) {
          fitTreemapLabelVisibility(chart, appliedOption);
        }
      });
    } else {
      fitTreemapLabelVisibility(chart, next);
    }
  }

  createEffect(() => {
    void applyOption(option());
  });

  createEffect(() => {
    const handleResize = () => {
      chart?.resize();
      if (chart && appliedOption && typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          if (!disposed && chart && appliedOption) {
            fitTreemapLabelVisibility(chart, appliedOption);
          }
        });
      }
    };
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = undefined;
  });

  return (
    <Box
      data-testid="sector-heatmap-view"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      style={{ height: "100%" }}
    >
      <Show when={props.onSymbolClick && railSymbols().length > 0}>
        <Box
          data-testid="sector-heatmap-symbol-rail"
          role="group"
          aria-label="Stock tiles: choose a symbol to open its chart"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-fin-border px-2 py-1"
        >
          <Text c="dimmed" className="text-ui-micro whitespace-nowrap">Symbols</Text>
          <For each={railSymbols()}>
            {(symbol) => (
              <button
                type="button"
                data-testid={`sector-heatmap-symbol-${symbol}`}
                aria-label={`Open ${symbol} chart`}
                onClick={() => activate(symbol)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  // Native buttons also fire click on these keys; preventing
                  // the default keeps the dock from opening twice.
                  event.preventDefault();
                  activate(symbol);
                }}
                className="shrink-0 rounded-fin border border-fin-border bg-transparent px-1.5 py-0.5 text-ui-micro text-fin-text hover:text-fin-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text"
              >
                {symbol}
              </button>
            )}
          </For>
        </Box>
      </Show>
      <Box
        className="relative flex min-h-0 w-full flex-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-text"
        data-testid="sector-heatmap-chart"
        role="img"
        aria-label={chartLabel()}
        aria-describedby={descriptionId}
        tabIndex={0}
      >
        <div
          ref={(el) => (chartEl = el)}
          class="h-full w-full"
          style={{ "min-width": 0 }}
          aria-hidden="true"
        />
        <Show when={stockState()}>
          <div
            data-testid={`sector-heatmap-state-${stockState()}`}
            role={stockState() === "error" ? "alert" : "status"}
            class="absolute inset-0 z-10 flex items-center justify-center bg-fin-surface px-4 text-center text-ui-micro text-fin-text-muted"
          >
            {stockStateMessage()}
          </div>
        </Show>
      </Box>
      <p id={descriptionId} class="sr-only" data-testid="sector-heatmap-description">
        {chartDescription()}
      </p>
      <Show when={isSectorMode() && props.sectors.length > 0}>
        <div
          data-testid="sector-heatmap-legend"
          class="grid shrink-0 grid-cols-2 gap-x-2 gap-y-0.5 border-t border-fin-border px-2 py-1 sm:grid-cols-4 xl:grid-cols-5"
        >
          <For each={props.sectors}>
            {(sector) => (
              <div
                data-testid={`sector-heatmap-legend-${sector.sector}`}
                class="flex min-w-0 items-baseline gap-1 text-ui-micro"
                title={`${sector.sector} · ${formatPercentage(sector.avg_change)}`}
              >
                <span
                  aria-hidden="true"
                  class="inline-block size-[6px] shrink-0 rounded-full"
                  style={{
                    "background-color": getSignedMetricColor(
                      sector.avg_change,
                      sectorMin(),
                      sectorMax(),
                    ),
                  }}
                />
                <span class="min-w-0 truncate text-fin-text-muted">
                  {sectorTileName(sector.sector, compact())}
                </span>
                <span class="ml-auto shrink-0 font-mono tabular-nums text-fin-text">
                  {formatPercentage(sector.avg_change)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={isSectorMode() && props.sectors.length > 0}>
        <table class="sr-only" data-testid="sector-heatmap-data">
          <caption>Sector heatmap data: average change and stock count by sector</caption>
          <thead>
            <tr>
              <th scope="col">Sector</th>
              <th scope="col">Average change</th>
              <th scope="col">Stocks</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.sectors}>
              {(sector) => (
                <tr data-testid="sector-heatmap-data-row">
                  <th scope="row">{sector.sector}</th>
                  <td>{formatPercentage(sector.avg_change)}</td>
                  <td>{sector.stock_count}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Box>
  );
}

/** Kept for existing consumers: the sector page's stock treemap metric list. */
export { SECTOR_STOCK_METRICS as STOCK_METRICS };