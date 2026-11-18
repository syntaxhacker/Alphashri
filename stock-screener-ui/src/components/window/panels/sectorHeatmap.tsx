import { createMemo, onCleanup, onMount, Show, type Accessor } from "solid-js";
import { Box, Loader, Select, Text, ToolbarRow } from "@/ui";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import type { HeatmapStock } from "@/api/heatmap";
import type { StockMover } from "@/types/sector";
import type { MarketRow } from "@/types/marketScreener";
import type { SectorViewMode } from "@/state/sector";
import {
  configurePolling,
  getSectorState,
  loadSectorData,
  resetSectorState,
  setHeatmapMetric,
  setViewMode,
  subscribe,
} from "@/state/sector";
import { CompactToggle } from "../../sector/CompactToggle";
import { SectorHeatmapView } from "../../sector/SectorHeatmapView";
import { SECTOR_STOCK_METRICS } from "../../heatmap/stockTreemap";
import { toTreemapRow } from "../../market/marketTreemap";
import { useSymbolDock } from "../../common/symbolDockContext";
import type { DockPanelContext, DockPanelSpec } from "../../dock/types";

const VIEW_OPTIONS = [
  { value: "sector", label: "Sectors" },
  { value: "stock", label: "Stocks" },
] as const;

/**
 * The store is shared by every open sector panel, so a single panel must not
 * reset it on unmount. These two counters keep one load and one poll alive while
 * at least one panel is mounted, and tear the store down only on the last exit.
 */
let mounts = 0;
let inflight: Promise<void> | null = null;

function attach(): void {
  mounts += 1;
  // Repeating the same (tab, market) is a no-op in the store — two panels never
  // stack intervals or fire two initial requests.
  configurePolling("dashboard", getSectorState().market);
  const current = getSectorState();
  if (current.data || current.error || inflight) return;
  inflight = loadSectorData(current.market).finally(() => {
    inflight = null;
  });
}

function detach(): void {
  mounts = Math.max(0, mounts - 1);
  if (mounts === 0) resetSectorState();
}

/**
 * `top_stock_movers` carries only symbol/change. Supply the converter's input
 * shape with honest nulls for fields the feed does not provide; `toTreemapRow`
 * remains the single StockRow → HeatmapStock mapper, and the view renders "—"
 * for the missing fundamentals.
 */
function toHeatmapStocks(movers: StockMover[]): HeatmapStock[] {
  return movers.map((mover) => {
    const row: MarketRow = {
      symbol: mover.symbol,
      name: mover.symbol,
      sector: null,
      exchange: null,
      close: null,
      change: mover.change,
      relativeVolume: null,
      marketCapCr: null,
      capTier: null,
      rsi: null,
      adx: null,
      sma20: null,
      sma50: null,
      sma200: null,
      perfW: null,
      perf1m: null,
      high52w: null,
      low52w: null,
      pos52w: null,
      peRatio: null,
      pbRatio: null,
      dividendYield: null,
      roe: null,
      fno: false,
      etf: false,
    };
    return toTreemapRow(row);
  });
}

function SectorHeatmapPanel() {
  const dock = useSymbolDock();
  const version = useStoreSubscription(subscribe);
  const state = createMemo(() => {
    version();
    return getSectorState();
  });
  const stocks = createMemo(() => toHeatmapStocks(state().data?.top_stock_movers ?? []));
  const hasContent = createMemo(() =>
    state().viewMode === "stock"
      ? stocks().length > 0
      : (state().data?.sectors.length ?? 0) > 0,
  );

  onMount(attach);
  onCleanup(detach);

  return (
    <Box
      data-testid="sector-heatmap-panel"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <ToolbarRow className="shrink-0 gap-2 border-b border-fin-border px-2">
        <CompactToggle
          testId="sector-heatmap-view-toggle"
          label="Heatmap layer"
          value={state().viewMode}
          options={VIEW_OPTIONS}
          onChange={(value) => setViewMode(value as SectorViewMode)}
        />
        <Select
          size="xs"
          h={24}
          w={124}
          data-testid="sector-heatmap-metric"
          aria-label="Heatmap metric"
          value={state().heatmapMetric}
          onChange={(value) => setHeatmapMetric(value || "change_pct")}
          data={SECTOR_STOCK_METRICS}
        />
        <Text size="xs" c="dimmed" className="min-w-0 truncate">
          {state().market}
        </Text>
      </ToolbarRow>

      <Box className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Show
          when={!state().loading || state().data != null}
          fallback={
            <Box
              data-testid="sector-heatmap-loading"
              className="flex min-h-0 flex-1 items-center justify-center gap-2 p-2"
            >
              <Loader size="sm" />
              <Text size="xs" c="dimmed">
                Loading sector performance…
              </Text>
            </Box>
          }
        >
          <Show
            when={!state().error}
            fallback={
              <Box
                data-testid="sector-heatmap-error"
                role="alert"
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-3 text-center"
              >
                <Text size="xs" c="error">
                  {state().error}
                </Text>
                <button
                  type="button"
                  class="rounded-sm border border-fin-border px-2 text-[11px] text-fin-text hover:bg-fin-surface-alt"
                  onClick={() => void loadSectorData(state().market)}
                >
                  Retry
                </button>
              </Box>
            }
          >
            <Show
              when={hasContent()}
              fallback={
                <Box
                  data-testid="sector-heatmap-empty"
                  className="flex min-h-0 flex-1 items-center justify-center p-2"
                >
                  <Text size="xs" c="dimmed">
                    No {state().viewMode} data for this market.
                  </Text>
                </Box>
              }
            >
              <SectorHeatmapView
                viewMode={state().viewMode}
                sectors={state().data?.sectors ?? []}
                stocks={stocks()}
                metric={state().heatmapMetric}
                onSymbolClick={(symbol) => dock.open(symbol)}
              />
            </Show>
          </Show>
        </Show>
      </Box>
    </Box>
  );
}

export const SECTOR_HEATMAP_PANEL: DockPanelSpec = {
  id: "sector.heatmap",
  page: "sector",
  title: "SECTOR HEATMAP",
  size: 1,
  minWidth: 320,
  singleton: false,
  requires: [],
  mount: (_ctx: Accessor<DockPanelContext>) => <SectorHeatmapPanel />,
};
