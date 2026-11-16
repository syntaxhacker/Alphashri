import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { Box, SegmentedControl, Select, Text, ToolbarRow } from "@/ui";
import { HeatmapTreemap } from "@/components/heatmap/HeatmapTreemap";
import {
  MARKET_METRICS,
  isMarketSignedMetric,
  marketRowsByCapDesc,
  marketSortMetric,
  toTreemapRow,
} from "./marketTreemap";
import { DEFAULT_MARKET_SORT, MARKET_SORT_OPTIONS, type MarketSortKey } from "./marketFilters";
import type { MarketRow } from "@/types/marketScreener";

export interface MarketMapViewProps {
  rows: MarketRow[];
  onSymbolClick?: (symbol: string) => void;
  /** The screener's sort; drives the tile colour, never the tile geometry. */
  sort?: MarketSortKey;
  onSortChange?: (sort: MarketSortKey) => void;
}

export const MARKET_VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "map", label: "Map" },
  { value: "movers", label: "Movers" },
] as const;

export type MarketViewMode = (typeof MARKET_VIEW_OPTIONS)[number]["value"];

const EMPTY: MarketRow[] = [];

const METRIC_OPTIONS = MARKET_METRICS.map((m) => ({ value: m.value, label: m.label }));
const SORT_OPTIONS = MARKET_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

export function MarketMapView(props: MarketMapViewProps) {
  // Seeded from the incoming sort so the first frame already agrees with it;
  // the effect below then only reacts to *changes* and never churns the select.
  const [metric, setMetric] = createSignal(
    (props.sort ? marketSortMetric(props.sort) : null) ?? "change_pct",
  );
  const stocks = createMemo(() =>
    marketRowsByCapDesc(props.rows ?? EMPTY).map(toTreemapRow),
  );

  // The layout stays cap-ordered, so the sort only has a colour/metric left to
  // act on: without this the control reads as inert.
  createEffect(
    on(
      () => props.sort,
      (sort) => {
        if (!sort) return;
        const mapped = marketSortMetric(sort);
        if (mapped === null || mapped === metric()) return;
        setMetric(mapped);
      },
      { defer: true },
    ),
  );

  const chooseSort = (value: string | null) => {
    if (!value) return;
    const sort = value as MarketSortKey;
    props.onSortChange?.(sort);
    const mapped = marketSortMetric(sort);
    if (mapped !== null && mapped !== metric()) setMetric(mapped);
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
        <Text size="xs" c="dimmed">
          Color by
        </Text>
        <Select
          size="xs"
          w={128}
          className="min-w-[128px]"
          value={metric()}
          onChange={(v) => setMetric(v ?? MARKET_METRICS[0].value)}
          data={METRIC_OPTIONS}
          aria-label="Color the map by"
          data-testid="market-map-metric"
        />
        <Show when={props.onSortChange}>
          <Text size="xs" c="dimmed">
            Sort
          </Text>
          <Select
            size="xs"
            w={148}
            className="min-w-[148px]"
            value={props.sort ?? DEFAULT_MARKET_SORT}
            onChange={chooseSort}
            data={SORT_OPTIONS}
            aria-label="Sort rows"
            data-testid="market-map-sort"
          />
        </Show>
        <Box className="flex-1 min-w-0" />
        <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-map-count">
          {stocks().length} stocks
        </Text>
      </ToolbarRow>
      <HeatmapTreemap
        stocks={stocks()}
        metric={metric()}
        metrics={MARKET_METRICS}
        showMetricSelect={false}
        isSignedMetric={isMarketSignedMetric}
        onSymbolClick={props.onSymbolClick}
        sizeBy="market_cap"
        testId="market-map"
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
