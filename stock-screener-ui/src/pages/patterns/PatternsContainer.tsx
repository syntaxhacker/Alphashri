import { useEffect, useRef, useState } from "react";
import { useChartPatterns } from "@/hooks/useChartPatterns";
import { usePatternUrlSync } from "@/hooks/usePatternUrlSync";
import { DEFAULT_TIMEFRAME, loadCatalog, triggerReplayScan } from "@/state/chartPatterns";
import { PatternsPage } from "./PatternsPage";
import type { ReplayScanArgs } from "@/components/patterns/ReplayScanControl";
import type { IndexGroup } from "@/config/indexGroups";

/** Route entry for `/patterns` — wires the store hook to the presentational page. */
export function PatternsContainer() {
  const vm = useChartPatterns();
  const [tab, setTab] = useState<"scan" | "watch">("scan");
  const [view, setView] = useState<"matrix" | "list" | "grid">("matrix");
  const [indexGroup, setIndexGroup] = useState<IndexGroup>("all");
  const [members, setMembers] = useState<string | null>(null);
  const catalogRequested = useRef(false);

  // Mirror universe/timeframe/filters to the URL so a filtered view is shareable.
  usePatternUrlSync({
    universe: vm.universe,
    timeframe: vm.timeframe,
    selectedTimeframes: vm.selectedTimeframes,
    lookbackBars: vm.lookbackBars,
    computeTrendlines: vm.computeTrendlines,
    tab,
    view,
    indexGroup,
    members,
    filters: vm.filters,
    setUniverse: vm.setUniverse,
    setTimeframe: vm.setTimeframe,
    setSelectedTimeframes: vm.setSelectedTimeframes,
    setLookbackBars: vm.setLookbackBars,
    setComputeTrendlines: vm.setComputeTrendlines,
    setTab,
    setView,
    setIndexGroup,
    setMembers,
    applyFilters: vm.applyFilters,
  });

  useEffect(() => {
    if (catalogRequested.current) return;
    catalogRequested.current = true;
    void loadCatalog();
  }, []);

  useEffect(() => {
    if (vm.timeframes.length === 0) return;
    if (vm.timeframes.some((tf) => tf.id === vm.timeframe)) return;
    vm.setTimeframe(DEFAULT_TIMEFRAME);
  }, [vm.timeframes, vm.timeframe, vm.setTimeframe]);

  return (
    <PatternsPage
      timeframes={vm.timeframes}
      universes={vm.universes}
      patterns={vm.patterns}
      timeframe={vm.timeframe}
      setTimeframe={vm.setTimeframe}
      selectedTimeframes={vm.selectedTimeframes}
      setSelectedTimeframes={vm.setSelectedTimeframes}
      lookbackBars={vm.lookbackBars}
      setLookbackBars={vm.setLookbackBars}
      universe={vm.universe}
      setUniverse={vm.setUniverse}
      filters={vm.filters}
      setFilter={vm.setFilter}
      resetFilters={vm.resetFilters}
      applyFilters={vm.applyFilters}
      computeTrendlines={vm.computeTrendlines}
      setComputeTrendlines={vm.setComputeTrendlines}
      customUniverse={vm.customUniverse}
      selectSymbols={vm.selectSymbols}
      job={vm.job}
      scanning={vm.scanning}
      queuePosition={vm.queuePosition}
      summary={vm.summary}
      results={vm.results}
      total={vm.total}
      streaming={vm.streaming}
      loading={vm.loading}
      error={vm.error}
      scan={vm.scan}
      refresh={vm.refresh}
      forceRefresh={vm.forceRefresh}
      scanReplay={(args: ReplayScanArgs) => {
        void triggerReplayScan(args.asOf, args.from);
      }}
      replayAsOf={vm.lastScanAsOf}
      tab={tab}
      setTab={setTab}
      view={view}
      setView={setView}
      indexGroup={indexGroup}
      setIndexGroup={setIndexGroup}
      members={members}
      setMembers={setMembers}
    />
  );
}
