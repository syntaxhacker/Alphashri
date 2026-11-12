import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { HeatmapTreemap } from "../../pages/heatmap/HeatmapTreemap";
import type { Stock } from "../../types";
import {
  SCREENER_HEATMAP_METRICS,
  defaultScreenerHeatmapMetric,
  stocksToHeatmapRows,
} from "./screenerHeatmap";

interface Props {
  stocks: Stock[];
  activeScreener: string;
  onSymbolClick: (symbol: string) => void;
  testId?: string;
}

/** NSE heatmap page treemap, fed with screener result rows. */
export function ScreenerHeatmapView(props: Props) {
  const [metric, setMetric] = createSignal(defaultScreenerHeatmapMetric(props.activeScreener));

  createEffect(() => {
    setMetric(defaultScreenerHeatmapMetric(props.activeScreener));
  });

  const rows = createMemo(() => stocksToHeatmapRows(props.stocks));
  const chartHeight = createMemo(() => Math.max(320, Math.min(560, 40 + rows().length * 14)));

  return (
    <Show when={rows().length > 0}>
      <HeatmapTreemap
        stocks={rows()}
        metrics={SCREENER_HEATMAP_METRICS}
        metric={metric()}
        onMetricChange={setMetric}
        showMetricSelect
        showLegend
        chartHeight={chartHeight()}
        onSymbolClick={(symbol: string) => props.onSymbolClick(symbol)}
        testId={props.testId ?? "screener-heatmap"}
      />
    </Show>
  );
}
