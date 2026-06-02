import { useState, useEffect } from "react";
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
export function ScreenerHeatmapView({
  stocks,
  activeScreener,
  onSymbolClick,
  testId = "screener-heatmap",
}: Props) {
  const [metric, setMetric] = useState(() => defaultScreenerHeatmapMetric(activeScreener));

  useEffect(() => {
    setMetric(defaultScreenerHeatmapMetric(activeScreener));
  }, [activeScreener]);

  const rows = stocksToHeatmapRows(stocks);

  if (rows.length === 0) {
    return null;
  }

  const chartHeight = Math.max(320, Math.min(560, 40 + rows.length * 14));

  return (
    <HeatmapTreemap
      stocks={rows}
      metrics={SCREENER_HEATMAP_METRICS}
      metric={metric}
      onMetricChange={setMetric}
      showMetricSelect
      showLegend
      chartHeight={chartHeight}
      onSymbolClick={onSymbolClick}
      testId={testId}
    />
  );
}