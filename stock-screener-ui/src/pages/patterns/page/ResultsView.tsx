import { Show } from "solid-js";
import { Box, Loader, Text } from "@/ui";
import { PatternGrid } from "@/components/patterns/PatternGrid";
import { PatternListView } from "@/components/patterns/PatternListView";
import { PatternNarrowResults } from "@/components/patterns/PatternNarrowResults";
import { PatternSymbolMatrix } from "@/components/patterns/PatternSymbolMatrix";
import { usePatternsNarrow } from "@/components/patterns/narrowLayout";
import { PatternFullscreenView } from "@/components/patterns/PatternFullscreenView";
import type { PatternsPageModel } from "./usePatternsPage";

export type ResultsViewModel = Pick<
  PatternsPageModel,
  | "view"
  | "filters"
  | "openFromCard"
  | "filteredMatrixRows"
  | "matrixVisibleTimeframes"
  | "openChartHit"
  | "changeMembers"
  | "fullscreen"
  | "setMatrixOrder"
  | "setListOrder"
  | "filteredLatest"
  | "requestSymbolPreview"
  | "endSymbolPreview"
  | "openSymbolPinned"
  | "showRefresh"
  | "isDesktop"
  | "activeTab"
  | "chartMaximized"
  | "chartViewProps"
  | "pinFullscreen"
  | "cancelPreviewClose"
  | "stepChart"
  | "activeIndex"
  | "dockSequence"
  | "closeChart"
  | "setChartMaximized"
  | "changeFullscreenAsOf"
>;

/** Result grid (matrix/list/grid) plus the docked chart rail. */
export function ResultsView(props: { model: ResultsViewModel }) {
  const m = props.model;
  const narrow = usePatternsNarrow();
  // The matrix is symbol-keyed, so each row contributes its best hit to the
  // phone list; the list/grid views already carry one hit per row/card.
  const narrowHits = () =>
    m.view() === "matrix"
      ? m.filteredMatrixRows().flatMap((row) => (row.best ? [row.best] : []))
      : m.filteredLatest();
  return (
    <Box className="flex flex-1 min-h-0 h-0 min-w-0 items-stretch gap-2 overflow-hidden">
      <Box className="relative flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
        <Show
          when={narrow()}
          fallback={
            m.view() === "matrix" ? (
          <PatternSymbolMatrix
            rows={m.filteredMatrixRows()}
            timeframes={m.matrixVisibleTimeframes()}
            onSelect={m.openChartHit}
            onShowMembers={m.changeMembers}
            activeSymbol={m.fullscreen()?.hit?.symbol ?? null}
            onRowsChange={m.setMatrixOrder}
            onSymbolPreview={m.requestSymbolPreview}
            onSymbolPreviewEnd={m.endSymbolPreview}
            onSymbolOpen={m.openSymbolPinned}
          />
        ) : m.view() === "list" ? (
          <PatternListView
            hits={m.filteredLatest()}
            onSelect={m.openChartHit}
            onShowMembers={m.changeMembers}
            sort={m.filters().sort}
            activeHit={m.fullscreen()?.hit ?? null}
            onOrderChange={m.setListOrder}
            onSymbolPreview={m.requestSymbolPreview}
            onSymbolPreviewEnd={m.endSymbolPreview}
            onSymbolOpen={m.openSymbolPinned}
          />
        ) : (
          <div
            data-testid="patterns-grid-scroll-region"
            data-scroll="vertical"
            role="region"
            aria-label="Pattern cards, scroll for more results"
            tabIndex={0}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-fin-primary"
          >
            <PatternGrid
              hits={m.filteredLatest()}
              onSelect={m.openChartHit}
              onExpand={m.openFromCard}
              onShowMembers={m.changeMembers}
              activeHit={m.fullscreen()?.hit ?? null}
              onSymbolPreview={m.requestSymbolPreview}
              onSymbolPreviewEnd={m.endSymbolPreview}
              onSymbolOpen={m.openSymbolPinned}
            />
          </div>
            )
          }
        >
          <PatternNarrowResults hits={narrowHits()} onSelect={m.openChartHit} />
        </Show>
        <Show when={m.showRefresh()}>
          <Box
            data-testid="patterns-refreshing"
            className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-2 rounded-fin border border-fin-border bg-fin-surface px-2 py-1 shadow-sm"
          >
            <Loader size="xs" />
            <Text size="xs" c="dimmed">
              Refreshing
            </Text>
          </Box>
        </Show>
      </Box>
      {m.isDesktop() && m.activeTab() === "scan" && m.fullscreen() && !m.chartMaximized() ? (
        <Box
          data-testid="patterns-chart-dock-shell"
          onMouseEnter={m.cancelPreviewClose}
          onMouseLeave={m.endSymbolPreview}
          onMouseDown={m.pinFullscreen}
          className="flex h-full min-h-0 min-w-0 shrink-0 flex-col self-stretch overflow-hidden lg:w-[460px] xl:w-[620px]"
        >
          <PatternFullscreenView
            {...m.chartViewProps}
            opened
            docked
            onAsOfChange={undefined}
            onLive={() => m.changeFullscreenAsOf(null, null)}
            onPrev={() => m.stepChart(-1)}
            onNext={() => m.stepChart(1)}
            positionLabel={
              m.activeIndex() >= 0
                ? `${m.activeIndex() + 1} / ${m.dockSequence().length}`
                : undefined
            }
            onClose={m.closeChart}
            onMaximize={() => m.setChartMaximized(true)}
          />
        </Box>
      ) : null}
    </Box>
  );
}
