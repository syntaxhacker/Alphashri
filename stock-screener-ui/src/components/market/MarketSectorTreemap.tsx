import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Box, Modal, Select, Text, ToolbarRow, useColorScheme, typeSize } from "@/ui";
import { IconArrowsMaximize } from "@/ui/icons";
import * as palette from "@/ui/palette";
import {
  resolveStockMetric,
  safeFmt,
  type MetricConfig,
  type StockTreemapStyle,
} from "@/components/heatmap/stockTreemap";
import { loadEcharts } from "@/utils/loadEcharts";
import type { HeatmapStock } from "@/api/heatmap";
import {
  buildSectorTreemapOption,
  DEFAULT_MARKET_SIZE_METRIC,
  isMarketSizeMetric,
  marketColorDomain,
  marketColorRampCss,
  MARKET_COLOR_SCALE_NOTE,
  marketMetricOptions,
  marketTileColor,
  marketTileTextColor,
  marketTreemapMetrics,
  toTreemapRow,
  type MarketSizeMetric,
  type MarketTreemapRow,
  type SectorTreemapTile,
} from "./marketTreemap";
import type { VisRenderProps } from "./MarketMapView";

/** Same leaf look as the flat market map: only the nesting is different. */
const NESTED_TREEMAP_STYLE: StockTreemapStyle = {
  borderDark: palette.SURFACE,
  borderLight: palette.CREAM,
  label: { fontSize: typeSize("micro"), fontWeight: "bold", lineHeight: 14 },
  colorSaturation: [0.35, 0.5],
  changePositive: palette.POSITIVE_COLOR,
  changeNegative: palette.NEGATIVE_COLOR,
};

type ClickParams = { data?: SectorTreemapTile };

/**
 * Owns one ECharts instance. The shared builder owns tile area and order; this
 * canvas repaints stock children from the SELECTED metric, so label, size and
 * colour agree. Sector parents and the "Other (n)" rollup keep their neutral
 * fill. Uses the same helper as the flat map so both surfaces colour alike.
 */
function SectorTreemapCanvas(props: {
  option: ReturnType<typeof buildSectorTreemapOption>["option"];
  stocks: HeatmapStock[];
  metric: MarketSizeMetric;
  metrics: MetricConfig[];
  onSymbolClick?: (symbol: string) => void;
  onSizeChange?: (width: number, height: number) => void;
  testId: string;
  emptyTestId: string;
}) {
  let chartEl: HTMLDivElement | undefined;
  let chart: any = null;
  let disposed = false;
  let resizeFrame = 0;
  let observer: ResizeObserver | null = null;

  // No usable sector tiles means the canvas would be blank. Derive this from
  // the built option so rows filtered out by an unusable size metric count as
  // empty too, not just a literally empty `rows` array.
  const hasTiles = createMemo(() => (props.option.series[0].data ?? []).length > 0);

  const colorDomain = createMemo(() => marketColorDomain(props.stocks, props.metric));

  const coloredOption = createMemo(() => {
    const { min, max } = colorDomain();
    const data = (props.option.series[0].data ?? []).map((sector) => ({
      ...sector,
      children: sector.children?.map((child) => {
        if (child.isOther) return child;
        const raw = Number(child.metricNumeric);
        const value = Number.isFinite(raw) ? raw : 0;
        return {
          ...child,
          itemStyle: { ...(child.itemStyle as Record<string, unknown> | undefined), color: marketTileColor(props.metric, value, min, max) },
          label: { ...(child.label as Record<string, unknown> | undefined), color: marketTileTextColor(props.metric, value, min, max) },
        };
      }),
    }));
    return { ...props.option, series: [{ ...props.option.series[0], data }] };
  });

  const colorMetric = createMemo(() => resolveStockMetric(props.metrics, props.metric));
  const sizeMetric = createMemo(() => resolveStockMetric(props.metrics, props.metric));

  const handleClick = (params: ClickParams) => {
    const tile = params?.data;
    // Parents are containers and "Other (n)" is an aggregate, neither is a symbol.
    if (tile && !tile.sectorParent && !tile.isOther && typeof tile.name === "string") {
      props.onSymbolClick?.(tile.name);
    }
  };

  onMount(() => {
    // A ResizeObserver is the source of truth for tile-width label hiding;
    // report the first measured box too so the option starts out correct in
    // browsers where the observer has not fired yet.
    if (chartEl && chartEl.clientWidth > 0 && chartEl.clientHeight > 0) {
      props.onSizeChange?.(chartEl.clientWidth, chartEl.clientHeight);
    }
    void loadEcharts().then((lib) => {
      if (disposed || !lib || !chartEl) return;
      chart = lib.init(chartEl, undefined, { renderer: "canvas" });
      chart.setOption(coloredOption());
      chart.on("click", handleClick);
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
    const next = coloredOption();
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
    <Box className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid={props.testId}>
      <Show
        when={hasTiles()}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid={props.emptyTestId}
          >
            <Text span size="sm" c={palette.VIZ_MUTED}>
              No sector data in the current filter.
            </Text>
          </Box>
        }
      >
        <Box className="flex-1 w-full flex p-2" style={{ "min-height": "320px" }}>
          <div
            ref={(el) => (chartEl = el)}
            data-testid={`${props.testId}-canvas`}
            style={{ height: "100%", width: "100%" }}
          />
        </Box>
      </Show>
      <Show when={hasTiles() && props.stocks.length > 0}>
        {/* Below sm the notes move into a compact two-line band inside the
            legend; at sm and up they sit inline. The numeric range and the
            scale semantics stay visible at both widths. */}
        <Box
          className="flex flex-wrap items-center gap-2 px-2 py-1 h-auto min-h-8 flex-shrink-0 border-t border-fin-border"
          title={`size: ${sizeMetric().label} · ${MARKET_COLOR_SCALE_NOTE}${
            colorDomain().clampedLow || colorDomain().clampedHigh ? " · saturates past bounds" : ""
          }`}
          data-testid={`${props.testId}-legend`}
        >
          <Text size="xs" fw={600} data-testid={`${props.testId}-color-label`}>
            {colorMetric().label}
          </Text>
          <Text size="xs" c="dimmed" className="hidden sm:inline" title={`size: ${sizeMetric().label}`}>
            size: {sizeMetric().label}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            className="hidden sm:inline"
            title={MARKET_COLOR_SCALE_NOTE}
            data-testid={`${props.testId}-color-direction`}
          >
            {MARKET_COLOR_SCALE_NOTE}
          </Text>
          <Box className="flex flex-wrap items-center gap-2" data-testid={`${props.testId}-color-range`}>
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
              className="hidden sm:inline"
              title="saturates past bounds"
              data-testid={`${props.testId}-color-clamp-note`}
            >
              saturates past bounds
            </Text>
          </Show>
          <Box
            className="sm:hidden flex flex-wrap w-full h-auto gap-1"
            data-testid={`${props.testId}-narrow-notes`}
          >
            <Text
              size="xs"
              c="dimmed"
              className="w-full"
              data-testid={`${props.testId}-color-direction-narrow`}
            >
              {MARKET_COLOR_SCALE_NOTE}
            </Text>
            <Show when={colorDomain().clampedLow || colorDomain().clampedHigh}>
              <Text
                size="xs"
                c="dimmed"
                className="w-full"
                data-testid={`${props.testId}-color-clamp-note-narrow`}
              >
                saturates past bounds
              </Text>
            </Show>
          </Box>
        </Box>
      </Show>
    </Box>
  );
}

/** The Size by control is shared verbatim between the card and the fullscreen view. */
function SizeControl(props: {
  metric: MarketSizeMetric;
  options: ReturnType<typeof marketMetricOptions>;
  onChange: (metric: MarketSizeMetric) => void;
  testId: string;
}) {
  return (
    <Select
      size="xs"
      w={128}
      className="min-w-[128px]"
      value={props.metric}
      onChange={(value: string | null) => {
        if (isMarketSizeMetric(value)) props.onChange(value);
      }}
      data={props.options}
      aria-label="Size the sector map by"
      data-testid={props.testId}
    />
  );
}

/**
 * Second Vis: a nested sector → stocks treemap. Sector block area is the sum
 * of its stocks' sizes; each stock tile's label, size and colour all come from
 * the selected Size by metric, identical to the flat map.
 */
export function MarketSectorTreemap(props: VisRenderProps) {
  const { colorScheme } = useColorScheme();
  const initialMetric: MarketSizeMetric = isMarketSizeMetric(props.sizeBy)
    ? props.sizeBy
    : DEFAULT_MARKET_SIZE_METRIC;
  const [localMetric, setLocalMetric] = createSignal<MarketSizeMetric>(initialMetric);
  const [expanded, setExpanded] = createSignal(false);
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
  const stocks = createMemo<MarketTreemapRow[]>(() =>
    (props.rows ?? []).map((row) => toTreemapRow(row, props.currency)),
  );
  const metrics = createMemo(() => marketTreemapMetrics(props.currency));
  const metricOptions = createMemo(() => marketMetricOptions(props.currency));
  const built = createMemo(() =>
    buildSectorTreemapOption(
      stocks(),
      metric(),
      metrics(),
      colorScheme() === "dark",
      NESTED_TREEMAP_STYLE,
      { width: chartWidth(), height: chartHeight() },
    ),
  );

  const chooseMetric = (value: MarketSizeMetric) => {
    if (value === metric()) return;
    setLocalMetric(value);
    props.onSizeByChange?.(value);
  };

  const canvasProps = () => ({
    option: built().option,
    stocks: stocks() as HeatmapStock[],
    metric: metric(),
    metrics: metrics(),
    onSymbolClick: props.onSymbolClick,
    onSizeChange: (width: number, height: number) => {
      setChartWidth(width);
      setChartHeight(height);
    },
  });

  return (
    <Box className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="market-sector-map-view">
      <ToolbarRow
        gap={8}
        wrap={false}
        clip
        className="px-2 h-10 flex-shrink-0 border-b border-fin-border"
        data-testid="market-sector-map-toolbar"
      >
        <Show when={props.showSizeControl !== false}>
          <Text size="xs" c="dimmed">
            Size by
          </Text>
          <SizeControl
            metric={metric()}
            options={metricOptions()}
            onChange={chooseMetric}
            testId="market-sector-map-metric"
          />
        </Show>
        <Box className="flex-1 min-w-0" />
        <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-sector-map-count">
          {built().stockCount} stocks · {built().sectorCount} sectors
        </Text>
        <button
          type="button"
          aria-label="Expand sector treemap"
          title="Expand to fullscreen"
          onClick={() => setExpanded(true)}
          data-testid="market-sector-map-expand"
          className="flex size-6 shrink-0 items-center justify-center rounded text-fin-text-muted hover:text-fin-text hover:bg-fin-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fin-text"
        >
          <IconArrowsMaximize size={14} />
        </button>
      </ToolbarRow>

      <Show when={!expanded()}>
        <SectorTreemapCanvas
          {...canvasProps()}
          testId="market-sector-map"
          emptyTestId="market-sector-map-empty"
        />
      </Show>

      <Show when={expanded()}>
        <Modal
          opened
          onClose={() => setExpanded(false)}
          fullScreen
          withCloseButton
          padding={0}
          title="Sector treemap"
          data-testid="market-sector-fullscreen-modal"
        >
          <Box className="flex h-full min-h-0 flex-col">
            <ToolbarRow
              gap={8}
              wrap={false}
              clip
              className="px-2 h-10 flex-shrink-0 border-b border-fin-border"
              data-testid="market-sector-fullscreen-toolbar"
            >
              <Show when={props.showSizeControl !== false}>
                <Text size="xs" c="dimmed">
                  Size by
                </Text>
                <SizeControl
                  metric={metric()}
                  options={metricOptions()}
                  onChange={chooseMetric}
                  testId="market-sector-fullscreen-metric"
                />
              </Show>
              <Box className="flex-1 min-w-0" />
              <Text size="xs" c="dimmed" className="whitespace-nowrap">
                {built().stockCount} stocks · {built().sectorCount} sectors
              </Text>
            </ToolbarRow>
            <SectorTreemapCanvas
              {...canvasProps()}
              testId="market-sector-map-full"
              emptyTestId="market-sector-map-full-empty"
            />
          </Box>
        </Modal>
      </Show>
    </Box>
  );
}
