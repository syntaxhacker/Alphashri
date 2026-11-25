import { Suspense, batch, type JSX } from "solid-js";
import { Tabs } from "@/ui";
import { IndexMembersDrawer } from "@/components/patterns/IndexMembersDrawer";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import { PatternSkeleton } from "@/components/patterns/PatternSkeleton";
import { usePatternsPage } from "./page/usePatternsPage";
import { PageShell } from "./page/PageShell";
import { PageHeader } from "./page/PageHeader";
import { ScanToolbar } from "./page/ScanToolbar";
import { ResultsToolbar } from "./page/ResultsToolbar";
import { ResultsSurface } from "./page/ResultsSurface";
import { ResultsView } from "./page/ResultsView";
import { WatchPanel } from "./page/WatchPanel";
import { FilterModal } from "./page/FilterModal";

export { PATTERNS_CSV_COLUMNS } from "./page/csvColumns";
export type { PatternsPageProps } from "./page/types";

import type { PatternsPageProps } from "./page/types";

function PatternsWorkspace(props: PatternsPageProps) {
  const vm = usePatternsPage(props);

  return (
    <PageShell
      model={vm}
      header={
        <PageHeader
          displaySummary={vm.displaySummary}
          job={vm.job()}
          onSelectStat={(kind) =>
            vm.toggleFilterValue(
              kind === "confirmed" ? "status" : "direction",
              kind === "confirmed" ? "confirmed" : kind,
            )
          }
        />
      }
      scanPanel={
        <Tabs.Panel
          value="scan"
          data-testid="patterns-panel-scan"
          className="flex flex-1 min-h-0 flex-col overflow-hidden"
          style={{ "padding-top": 0, "padding-bottom": 0 }}
        >
          <ScanToolbar
            universes={vm.universes}
            universe={vm.universe}
            setUniverse={vm.setUniverse}
            customUniverse={vm.customUniverse}
            customSymbolCount={() => vm.filters().symbols?.length ?? 0}
            selectSymbols={vm.selectSymbols}
            scan={vm.scan}
            scanning={vm.scanning}
            job={vm.job}
            queuePosition={vm.queuePosition}
            error={vm.error}
            forceRefresh={vm.forceRefresh}
            showCacheChip={() => vm.job()?.status === "completed" && !vm.scanActive()}
            actions={
              <ResultsToolbar
                filters={vm.filters}
                setFilter={vm.setFilter}
                selectSymbols={vm.selectSymbols}
                timeframes={vm.timeframes}
                timeframe={vm.timeframe}
                tfSelection={vm.tfSelection}
                setTimeframe={vm.setTimeframe}
                setSelectedTimeframes={vm.setSelectedTimeframes}
                lookbackBars={vm.lookbackBars}
                setLookbackBars={vm.setLookbackBars}
                scanReplay={vm.scanReplay}
                replayAsOf={vm.replayAsOf}
                computeTrendlines={vm.computeTrendlines}
                setComputeTrendlines={vm.setComputeTrendlines}
                view={vm.view}
                changeView={vm.changeView}
                universe={vm.universe}
                indexGroup={vm.indexGroup}
                changeIndexGroup={vm.changeIndexGroup}
                activeFilterCount={vm.activeFilterCount}
                activeFilterGroups={vm.activeFilterGroups}
                openFilters={() => vm.setFiltersOpen(true)}
                copyCsv={vm.handleCopyCsv}
                copySymbols={vm.handleCopySymbols}
                resultCount={() => vm.filteredLatest().length}
                rawResultCount={() => vm.results().length}
                scanning={vm.scanning}
                emptyCustom={vm.emptyCustom}
                forceRefresh={vm.forceRefresh}
                copyMsg={vm.copyMsg}
                copyFailed={vm.copyFailed}
                streaming={vm.streaming}
                total={vm.total}
              />
            }
          />
          <ResultsSurface model={vm} results={<ResultsView model={vm} />} />
        </Tabs.Panel>
      }
      watchPanel={() => <WatchPanel model={vm} />}
      overlays={
        <>
          <FilterModal model={vm} />
          <IndexMembersDrawer
            open={vm.members() != null}
            indexId={vm.members()}
            onClose={() => vm.changeMembers(null)}
            onScanMembers={vm.selectSymbols}
          />
          <PatternFullscreenView
            {...vm.chartViewProps}
            opened={
              !!vm.fullscreen() &&
              (!vm.isDesktop() || vm.chartMaximized() || vm.activeTab() !== "scan")
            }
            onClose={
              vm.isDesktop() && vm.chartMaximized() && vm.activeTab() === "scan"
                ? () => vm.setChartMaximized(false)
                : vm.closeChart
            }
            onPrev={() => vm.stepChart(-1)}
            onNext={() => vm.stepChart(1)}
            positionLabel={
              vm.activeIndex() >= 0
                ? `${vm.activeIndex() + 1} / ${vm.dockSequence().length}`
                : undefined
            }
          />
        </>
      }
    />
  );
}

export function PatternsPage(props: PatternsPageProps) {
  let tree!: JSX.Element;
  // Solid leaves its effect queue null when a Suspense is constructed outside
  // a reactive root (the page tests build the element eagerly); batch seeds it.
  batch(() => {
    tree = (
      <Suspense fallback={<PatternSkeleton />}>
        <PatternsWorkspace {...props} />
      </Suspense>
    );
  });
  return tree;
}
