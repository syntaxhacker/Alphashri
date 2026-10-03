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
      {...vm}
      setFilter={(key, value) => vm.setFilter(key as keyof PatternFilters, value)}
    />
  );
}
