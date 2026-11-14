import { createMemo, createSignal } from "solid-js";
import { Box, SegmentedControl } from "@/ui";
import { HeatmapTreemap } from "@/components/heatmap/HeatmapTreemap";
import { MARKET_METRICS, isMarketSignedMetric, toTreemapRow } from "./marketTreemap";
import type { MarketRow } from "@/types/marketScreener";

export interface MarketMapViewProps {
  rows: MarketRow[];
  onSymbolClick?: (symbol: string) => void;
}

export const MARKET_VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "map", label: "Map" },
] as const;

export type MarketViewMode = (typeof MARKET_VIEW_OPTIONS)[number]["value"];

const EMPTY: MarketRow[] = [];

export function MarketMapView(props: MarketMapViewProps) {
  const [metric, setMetric] = createSignal("change_pct");
  const stocks = createMemo(() => (props.rows ?? EMPTY).map(toTreemapRow));
  return (
    <Box className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="market-map-view">
      <HeatmapTreemap
        stocks={stocks()}
        metric={metric()}
        onMetricChange={setMetric}
        metrics={MARKET_METRICS}
        showMetricSelect
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
