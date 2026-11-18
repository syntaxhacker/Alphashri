import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js";
import { ActionIcon, Box, Select, Text, ToolbarRow } from "@/ui";
import type { CurrencyCode } from "@/config/currency";
import { MARKET_UNIVERSE_DESCRIPTORS, marketUniverseDescriptor } from "@/config/marketUniverses";
import type { MarketUniverse } from "@/types/marketScreener";
import type { DockPanelSpec } from "../../dock/types";
import { useSymbolDock } from "../../common/symbolDockContext";
import { MarketMapView } from "../../market/MarketMapView";
import {
  DEFAULT_MARKET_SIZE_METRIC,
  isMarketSizeMetric,
  MARKET_COLOR_SCALE_NOTE,
  marketMetricOptions,
  type MarketSizeMetric,
} from "../../market/marketTreemap";
import type { UseMarketSnapshotResult } from "../../market/useMarketSnapshotSolid";
import {
  acquireMarketSnapshot,
  releaseMarketSnapshot,
  type MarketSnapshotEntry,
} from "./marketSnapshotHub";
import {
  defaultMarketFilters,
  filterMarketRows,
  resetUniverseSpecificFilters,
  type MarketFilterState,
} from "../../market/marketFilters";
import { HeatmapFiltersControl } from "./heatmapFilters";

const HEATMAP_UNIVERSE: MarketUniverse = "all_equity";
const HEATMAP_CURRENCY: CurrencyCode = "INR";

const UNIVERSE_OPTIONS = MARKET_UNIVERSE_DESCRIPTORS.map(({ value, label }) => ({ value, label }));
const UNIVERSE_VALUES = new Set<string>(MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value));
// The subtitle borrows the legend's own direction phrase so the two cannot drift.
const LEGEND_DIRECTION = MARKET_COLOR_SCALE_NOTE.split(" · ")[0] ?? MARKET_COLOR_SCALE_NOTE;

function readUniverse(data: Record<string, unknown> | undefined): MarketUniverse {
  return (data?.universe ?? HEATMAP_UNIVERSE) as MarketUniverse;
}

function MarketHeatmapPanel(props: { data: Accessor<Record<string, unknown> | undefined> }) {
  const dock = useSymbolDock();
  const view = createMemo(() => readUniverse(props.data()));
  const [universe, setUniverse] = createSignal<MarketUniverse>(view());
  // A saved window config arriving later stays authoritative.
  createEffect(on(view, (value) => setUniverse(value)));

  // The snapshot hook is shared across windows showing the same universe. The
  // revision signal re-points this panel's facade when the shared entry changes.
  const [revision, setRevision] = createSignal(0);
  let entry: MarketSnapshotEntry | null = null;
  const attach = () => {
    const next = acquireMarketSnapshot(universe(), { deferCacheUntilEnabled: true });
    if (next === entry) {
      // acquire() already took a ref; the effect and onMount both call attach.
      releaseMarketSnapshot(next);
      return;
    }
    releaseMarketSnapshot(entry);
    entry = next;
    setRevision((n) => n + 1);
  };
  onMount(attach);
  createEffect(on(universe, () => attach()));
  onCleanup(() => {
    releaseMarketSnapshot(entry);
    entry = null;
  });
  const live = () => {
    revision();
    return entry?.hook;
  };
  const snapshot: UseMarketSnapshotResult = {
    snapshot: () => live()?.snapshot() ?? null,
    rows: () => live()?.rows() ?? [],
    total: () => live()?.total() ?? 0,
    updateMode: () => live()?.updateMode() ?? null,
    asOf: () => live()?.asOf() ?? null,
    isLoading: () => live()?.isLoading() ?? false,
    error: () => live()?.error() ?? null,
    refresh: (force) => live()?.refresh(force),
    lastUpdated: () => live()?.lastUpdated() ?? null,
    stale: () => live()?.stale() ?? false,
    ageSec: () => live()?.ageSec() ?? null,
    warming: () => live()?.warming() ?? false,
  };
  const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>(DEFAULT_MARKET_SIZE_METRIC);

  const currency = () => marketUniverseDescriptor(universe()).currency;
  const rows = () => snapshot.rows();
  const [filters, setFilters] = createSignal<MarketFilterState>(defaultMarketFilters(universe()));
  const patchFilters = (patch: Partial<MarketFilterState>) =>
    setFilters((prev) => ({ ...prev, ...patch }));
  const filteredRows = createMemo(() => filterMarketRows(rows(), filters()));
  const etfCount = createMemo(() => filteredRows().filter((row) => row.etf).length);
  const total = () => Math.max(snapshot.total(), rows().length);
  const formatCount = (count: number) =>
    count.toLocaleString(marketUniverseDescriptor(universe()).priceLocale);
  const metricOptions = createMemo(() => marketMetricOptions(currency()));
  const activeMetricLabel = () =>
    metricOptions().find((option) => option.value === sizeBy())?.label ?? sizeBy();
  const staleLabel = () => {
    const age = snapshot.ageSec();
    if (age == null) return "Stale data";
    if (age < 60) return `Stale data · ${Math.round(age)}s old`;
    return `Stale data · ${Math.round(age / 60)}m old`;
  };

  const chooseUniverse = (value: string | null) => {
    if (!value || !UNIVERSE_VALUES.has(value)) return;
    patchFilters(resetUniverseSpecificFilters(filters(), value as MarketUniverse));
    setUniverse(value as MarketUniverse);
  };
  const chooseMetric = (value: string | null) => {
    if (!isMarketSizeMetric(value)) return;
    setSizeBy(value);
  };

  return (
    <Box data-testid="market-heatmap-panel" className="flex h-full min-h-0 flex-col">
      <Box className="flex-shrink-0 border-b border-fin-border" data-testid="market-heatmap-context">
        <ToolbarRow
          gap={8}
          wrap={false}
          clip
          className="px-2 h-8"
          data-testid="market-heatmap-context-row"
        >
          <Select
            size="xs"
            w={112}
            value={universe()}
            onChange={chooseUniverse}
            data={UNIVERSE_OPTIONS}
            aria-label="Market universe"
            data-testid="market-heatmap-universe"
          />
          <Text size="xs" c="dimmed" className="whitespace-nowrap">
            Size &amp; colour:
          </Text>
          <Select
            size="xs"
            w={132}
            value={sizeBy()}
            onChange={chooseMetric}
            data={metricOptions()}
            aria-label="Size and colour metric"
            data-testid="market-heatmap-metric"
          />
          <HeatmapFiltersControl
            filters={filters()}
            rows={rows()}
            universe={universe()}
            onChange={patchFilters}
          />
          <Box className="flex-1 min-w-0" />
          <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-heatmap-count">
            {formatCount(filteredRows().length)} stocks · {formatCount(etfCount())}{" "}
            {etfCount() === 1 ? "ETF" : "ETFs"}
          </Text>
          <ActionIcon
            size="xs"
            variant="subtle"
            aria-label="Refresh market snapshot"
            title="Refresh market snapshot"
            data-testid="market-heatmap-refresh"
            onClick={() => snapshot.refresh(true)}
          >
            <span aria-hidden="true">⟳</span>
          </ActionIcon>
        </ToolbarRow>
        <Box className="px-2 pb-1" data-testid="market-heatmap-encoding-row">
          <Text size="xs" c="dimmed" className="truncate" data-testid="market-heatmap-encoding">
            Size = {activeMetricLabel()} · Colour = {activeMetricLabel()} ({LEGEND_DIRECTION}) ·{" "}
            <span data-testid="heatmap-filter-count">
              {formatCount(filteredRows().length)} of {formatCount(total())}
            </span>
          </Text>
          <Show when={snapshot.stale() || !!snapshot.error()}>
            <Text
              size="xs"
              c="warning"
              fw={600}
              data-testid="market-heatmap-stale"
              className="whitespace-nowrap"
            >
              {staleLabel()}
            </Text>
          </Show>
        </Box>
      </Box>
      <Box className="flex flex-1 min-h-0 flex-col">
        <Show
          when={snapshot.error()}
          fallback={
            <Show
              when={snapshot.isLoading() && snapshot.rows().length === 0}
              fallback={
                <Show
                  when={filteredRows().length > 0}
                  fallback={
                    <Box
                      data-testid="market-heatmap-empty"
                      className="flex h-full min-h-0 items-center justify-center p-2"
                    >
                      <Text size="xs" c="dimmed">
                        {rows().length > 0
                          ? "No stocks match these filters."
                          : "No stocks in this snapshot."}
                      </Text>
                    </Box>
                  }
                >
                  <MarketMapView
                    rows={filteredRows()}
                    currency={currency()}
                    sizeBy={sizeBy()}
                    onSizeByChange={setSizeBy}
                    showSizeControl={false}
                    onSymbolClick={(symbol) => dock.open(symbol)}
                  />
                </Show>
              }
            >
              <Box
                data-testid="market-heatmap-loading"
                className="flex h-full min-h-0 items-center justify-center p-2"
              >
                <Text size="xs" c="dimmed">Loading market snapshot…</Text>
              </Box>
            </Show>
          }
        >
          {(error) => (
            <Box
              data-testid="market-heatmap-error"
              className="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-2"
            >
              <Text size="xs" fw={600}>Market snapshot unavailable</Text>
              <Text size="xs" c="dimmed">{error().message}</Text>
            </Box>
          )}
        </Show>
      </Box>
    </Box>
  );
}

/** A real panel spec: no page-local signals, only the dock data accessor + own hook. */
export const MARKET_HEATMAP_PANEL: DockPanelSpec = {
  id: "market.heatmap",
  page: "screener",
  title: "MARKET HEATMAP",
  size: 1.2,
  minWidth: 360,
  singleton: true,
  requires: [],
  data: () => ({ universe: HEATMAP_UNIVERSE, currency: HEATMAP_CURRENCY }),
  mount: (_ctx, api) => <MarketHeatmapPanel data={api.data} />,
};
