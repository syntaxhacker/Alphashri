import { useEffect } from "react";
import { useChartPatterns } from "@/hooks/useChartPatterns";
import { usePatternUrlSync } from "@/hooks/usePatternUrlSync";
import { loadCatalog } from "@/state/chartPatterns";
import { PatternsPage } from "./PatternsPage";

// Bootstrap once per app session (StrictMode-safe): load timeframe registry,
// universes, catalog, then the first result page.
let catalogRequested = false;

/** Route entry for `/patterns` — wires the store hook to the presentational page. */
export function PatternsContainer() {
  const vm = useChartPatterns();

  // Mirror universe/timeframe/filters to the URL so a filtered view is shareable.
  usePatternUrlSync({
    universe: vm.universe,
    timeframe: vm.timeframe,
    filters: vm.filters,
    setUniverse: vm.setUniverse,
    setTimeframe: vm.setTimeframe,
    applyFilters: vm.applyFilters,
  });

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
      setFilter={vm.setFilter}
      resetFilters={vm.resetFilters}
      applyFilters={vm.applyFilters}
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
