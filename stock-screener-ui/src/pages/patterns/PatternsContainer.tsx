import { useEffect } from "react";
import { useChartPatterns } from "@/hooks/useChartPatterns";
import { loadCatalog } from "@/state/chartPatterns";
import type { PatternFilters } from "@/types/chartPatterns";
import { PatternsPage } from "./PatternsPage";

// Bootstrap once per app session (StrictMode-safe): load timeframe registry,
// universes, catalog, then the first result page.
let catalogRequested = false;

/** Route entry for `/patterns` — wires the store hook to the presentational page. */
export function PatternsContainer() {
  const vm = useChartPatterns();

  useEffect(() => {
    if (catalogRequested) return;
    catalogRequested = true;
    void loadCatalog();
  }, []);

  return (
    <PatternsPage
      timeframes={vm.timeframes}
      universes={vm.universes}
      patterns={vm.patterns}
      timeframe={vm.timeframe}
      setTimeframe={vm.setTimeframe}
      universe={vm.universe}
      setUniverse={vm.setUniverse}
      filters={vm.filters}
      setFilter={(key, value) => vm.setFilter(key as keyof PatternFilters, value)}
      resetFilters={vm.resetFilters}
      job={vm.job}
      scanning={vm.scanning}
      queuePosition={vm.queuePosition}
      summary={vm.summary}
      results={vm.results}
      total={vm.total}
      loading={vm.loading}
      error={vm.error}
      scan={vm.scan}
      refresh={vm.refresh}
    />
  );
}
