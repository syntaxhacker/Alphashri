import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { Box, SegmentedControl, Select, Text, ToolbarRow, useColorScheme } from "@/ui";
import type { HeatmapStock } from "@/api/heatmap";
import {
  buildStockTreemapOption,
  resolveStockMetric,
  safeFmt,
  type MetricConfig,
  type StockTreemapStyle,
} from "@/components/heatmap/stockTreemap";
import { loadEcharts } from "@/utils/loadEcharts";
import * as palette from "@/ui/palette";
import {
  DEFAULT_MARKET_SIZE_METRIC,
  isMarketSizeMetric,
  marketColorDomain,
  marketColorRampCss,
  MARKET_COLOR_SCALE_NOTE,
  marketMetricOptions,
  marketTileColor,
  marketTileTextColor,
  marketTreemapMetrics,
  suppressTinyFlatLabels,
  toTreemapRow,
  type MarketSizeMetric,
  type MarketTreemapRow,
} from "./marketTreemap";
import type { CurrencyCode } from "@/config/currency";
import type { MarketRow } from "@/types/marketScreener";
import { MarketSectorTreemap } from "./MarketSectorTreemap";

export interface MarketMapViewProps {
  rows: MarketRow[];
  onSymbolClick?: (symbol: string) => void;
  /** Quote currency of the current universe. Defaults to India. */
  currency?: CurrencyCode;
  /** Persisted sizing metric; day change when absent. Colour is never chosen here. */
  sizeBy?: MarketSizeMetric;
  onSizeByChange?: (metric: MarketSizeMetric) => void;
  /**
   * The panel owns the single Size by control in its Vis toolbar. Direct renders
   * (the viz's own unit tests) still show one; the panel passes false so there
   * is exactly one control on the page.
   */
  showSizeControl?: boolean;
}

export const MARKET_VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "vis", label: "Vis" },
  { value: "movers", label: "Movers" },
  { value: "value", label: "Value" },
] as const;

export type MarketViewMode = (typeof MARKET_VIEW_OPTIONS)[number]["value"];

const VIEW_IDS: ReadonlySet<string> = new Set(MARKET_VIEW_OPTIONS.map((o) => o.value));
// Saved configs and old `?view=` links still carry the pre-rename id; normalize
// on read so nothing downstream ever has to know the legacy spelling.
const LEGACY_VIEW_IDS: Readonly<Record<string, MarketViewMode>> = { map: "vis" };

export function normalizeMarketView(raw: unknown): MarketViewMode {
  if (typeof raw !== "string") return "table";
  const id = LEGACY_VIEW_IDS[raw] ?? raw;
  return VIEW_IDS.has(id) ? (id as MarketViewMode) : "table";
}

/**
 * The Vis tab hosts visualizations behind one registry. Adding a viz is a data
 * change: append to VIS_OPTIONS and add its renderer to VIS_RENDERERS. A future
 * selector only has to write the chosen `VisMode`.
 */
export const VIS_OPTIONS = [
  { value: "heatmap", label: "Heatmap" },
  { value: "sector", label: "Sector treemap" },
] as const;
export type VisMode = (typeof VIS_OPTIONS)[number]["value"];

export interface VisRenderProps {
  rows: MarketRow[];
  onSymbolClick?: (symbol: string) => void;
  currency?: CurrencyCode;
  sizeBy?: MarketSizeMetric;
  onSizeByChange?: (metric: MarketSizeMetric) => void;
  showSizeControl?: boolean;
}

export const VIS_RENDERERS: Record<VisMode, (props: VisRenderProps) => JSX.Element> = {
  heatmap: (props) => <MarketMapView {...props} />,
  sector: (props) => <MarketSectorTreemap {...props} />,
};

const EMPTY: MarketRow[] = [];

const TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: palette.SURFACE,
  borderLight: palette.CREAM,
  label: { fontSize: 10, fontWeight: "bold", lineHeight: 14 },
  colorSaturation: [0.35, 0.5],
  changePositive: palette.POSITIVE_COLOR,
  changeNegative: palette.NEGATIVE_COLOR,
  // The map is a ranked list in rectangle form: biggest tile first.
  sortTilesByValueDesc: true,
};

type TreemapDatum = {
  itemStyle?: Record<string, unknown>;
  label?: Record<string, unknown>;
  metricNumeric?: number;
  [key: string]: unknown;
};

/**
 * Owns the ECharts lifecycle. The shared builder owns area and tile order;
 * this canvas paints the fill from the tile's SELECTED metric value, so label,
 * size and colour all describe the same number. It reads `metricNumeric` by
 * datum rather than by array index, so recolouring cannot shift onto the wrong
 * stock when a sizing option drops a row with no value.
 */
function MarketTreemapCanvas(props: {
  built: ReturnType<typeof buildStockTreemapOption>;
  stocks: MarketTreemapRow[];
  metric: MarketSizeMetric;
  metrics: MetricConfig[];
  onSymbolClick?: (symbol: string) => void;
  onSizeChange?: (width: number, height: number) => void;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;
  let resizeFrame = 0;
  let observer: ResizeObserver | null = null;

  const input = () => props.stocks as HeatmapStock[];
  const colorDomain = createMemo(() => marketColorDomain(input(), props.metric));
  const option = createMemo(() => {
    const { min, max } = colorDomain();
    const data = (props.built.series[0].data as unknown as TreemapDatum[]).map((datum) => {
      const raw = Number(datum.metricNumeric);
      const value = Number.isFinite(raw) ? raw : 0;
      return {
        ...datum,
        itemStyle: { ...datum.itemStyle, color: marketTileColor(props.metric, value, min, max) },
        label: { ...datum.label, color: marketTileTextColor(props.metric, value, min, max) },
      };
    });
    return { ...props.built, series: [{ ...props.built.series[0], data }] };
  });

  const colorMetric = createMemo(() => resolveStockMetric(props.metrics, props.metric));
  const sizeMetric = createMemo(() => resolveStockMetric(props.metrics, props.metric));

  const handleClick = (params: { name?: string }) => {
    if (params?.name) props.onSymbolClick?.(params.name);
  };

  onMount(() => {
    if (chartEl && chartEl.clientWidth > 0 && chartEl.clientHeight > 0) {
      props.onSizeChange?.(chartEl.clientWidth, chartEl.clientHeight);
    }
    void loadEcharts().then((lib) => {
      if (disposed || !lib || !chartEl) return;
      chart = lib.init(chartEl, undefined, { renderer: "canvas" });
      chart.setOption(option());
      if (props.onSymbolClick) chart.on("click", handleClick);
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1]?.contentRect;
          if (!rect || rect.width <= 0 || rect.height <= 0 || resizeFrame) return;
          props.onSizeChange?.(rect.width, rect.height);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            chart?.resize();
          });
        });
        observer.observe(chartEl);
      }
    });
  });

  createEffect(() => {
    const next = option();
    chart?.setOption(next, { notMerge: true });
  });

  onCleanup(() => {
    disposed = true;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    observer?.disconnect();
    observer = null;
    chart?.dispose();
    chart = null;
  });

  return (
    <Box data-testid="market-map" className="flex-1 min-w-0 min-h-0 flex flex-col">
      <Box className="flex-1 w-full flex p-2" style={{ "min-height": "320px" }}>
        <div ref={(el) => (chartEl = el)} data-testid="market-map-canvas" style={{ height: "100%", width: "100%" }} />
      </Box>
      <Show when={props.stocks.length > 0}>
        <Box
          className="flex items-center gap-2 px-2 h-8 flex-shrink-0 border-t border-fin-border"
          data-testid="market-map-legend"
        >
          <Text size="xs" fw={600} data-testid="market-map-color-label">
            {colorMetric().label}
          </Text>
          <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-map-size-note">
            size: {sizeMetric().label}
          </Text>
          <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-map-color-direction">
            {MARKET_COLOR_SCALE_NOTE}
          </Text>
          <Box className="flex items-center gap-2" data-testid="market-map-color-range">
            <Box
              className="size-3 rounded"
              style={{
                width: "12px",
                height: "12px",
                "background-color": marketTileColor(
                  props.metric,
                  colorDomain().min,
                  colorDomain().min,
                  colorDomain().max,
                ),
                "border-radius": "2px",
              }}
            />
            <Text size="xs">
              {colorDomain().clampedLow ? "≤" : ""}
              {safeFmt(colorMetric(), colorDomain().min)}
            </Text>
            <Box
              className="flex-1 max-w-[120px] h-[8px] rounded-[4px]"
              style={{ background: marketColorRampCss() }}
            />
            <Box
              className="size-3 rounded"
              style={{
                width: "12px",
                height: "12px",
                "background-color": marketTileColor(
                  props.metric,
                  colorDomain().max,
                  colorDomain().min,
                  colorDomain().max,
                ),
                "border-radius": "2px",
              }}
            />
            <Text size="xs">
              {safeFmt(colorMetric(), colorDomain().max)}
              {colorDomain().clampedHigh ? "≥" : ""}
            </Text>
          </Box>
          <Show when={colorDomain().clampedLow || colorDomain().clampedHigh}>
            <Text
              size="xs"
              c="dimmed"
              className="whitespace-nowrap"
              data-testid="market-map-color-clamp-note"
            >
              saturates past bounds
            </Text>
          </Show>
        </Box>
      </Show>
    </Box>
  );
}

export function MarketMapView(props: MarketMapViewProps) {
  const { colorScheme } = useColorScheme();
  const initialMetric: MarketSizeMetric = isMarketSizeMetric(props.sizeBy)
    ? props.sizeBy
    : DEFAULT_MARKET_SIZE_METRIC;
  const [localMetric, setLocalMetric] = createSignal<MarketSizeMetric>(initialMetric);
  const [chartWidth, setChartWidth] = createSignal<number | undefined>(undefined);
  const [chartHeight, setChartHeight] = createSignal<number | undefined>(undefined);
  createEffect(
    on(
      () => props.sizeBy,
      (value) => {
        if (!isMarketSizeMetric(value)) return;
        if (value !== localMetric()) setLocalMetric(value);
      },
    ),
  );
  const metric = () => localMetric();

  const stocks = createMemo(() => (props.rows ?? EMPTY).map((row) => toTreemapRow(row, props.currency)));
  // The builder resolves the selected metric from this list: it must carry every
  // dropdown option, not just the five legacy size metrics, or a Valuation pick
  // silently falls back to the first metric's area.
  const metrics = createMemo(() => marketTreemapMetrics(props.currency));
  const metricOptions = createMemo(() => marketMetricOptions(props.currency));
  const built = createMemo(() => {
    const option = buildStockTreemapOption(
      stocks(),
      metric(),
      metrics(),
      colorScheme() === "dark",
      TREEMAP_STYLE,
      "metric",
    );
    return {
      ...option,
      series: [{
        ...option.series[0],
        data: suppressTinyFlatLabels(option.series[0].data, chartWidth(), chartHeight()),
      }],
    };
  });
  // The counter reads the builder's own output, not the filtered row list: a
  // row with no drawable area must not be reported as a tile on the map.
  const tileCount = createMemo(() => (built().series[0].data as unknown[]).length);

  const chooseMetric = (value: string | null) => {
    if (!isMarketSizeMetric(value)) return;
    setLocalMetric(value);
    props.onSizeByChange?.(value);
  };

  return (
    <Box className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="market-map-view">
      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="px-2 h-10 flex-shrink-0 border-b border-fin-border"
        data-testid="market-map-toolbar"
      >
        <Show when={props.showSizeControl !== false}>
          <Text size="xs" c="dimmed">
            Size by
          </Text>
          <Select
            size="xs"
            w={128}
            className="min-w-[128px]"
            value={metric()}
            onChange={chooseMetric}
            data={metricOptions()}
            aria-label="Size the map by"
            data-testid="market-map-metric"
          />
        </Show>
        <Box className="flex-1 min-w-0" />
        <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-map-count">
          {tileCount()} stocks
        </Text>
      </ToolbarRow>
      <MarketTreemapCanvas
        built={built()}
        stocks={stocks()}
        metric={metric()}
        metrics={metrics()}
        onSymbolClick={props.onSymbolClick}
        onSizeChange={(width, height) => {
          if (chartWidth() !== width) setChartWidth(width);
          if (chartHeight() !== height) setChartHeight(height);
        }}
      />
    </Box>
  );
}

export function MarketViewToggle(props: {
  value: MarketViewMode;
  onChange: (mode: MarketViewMode) => void;
}) {
  return (
    <SegmentedControl
      value={props.value}
      onChange={(value) => props.onChange(value as MarketViewMode)}
      data={MARKET_VIEW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
      size="xs"
      data-testid="market-view-toggle"
    />
  );
}
