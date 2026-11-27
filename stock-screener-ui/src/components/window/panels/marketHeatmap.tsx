import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js";
import { ActionIcon, Box, Button, Select, Text, ToolbarRow } from "@/ui";
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
  marketColorDomain,
  marketMetricOptions,
  marketTileColor,
  marketTileTextColor,
  marketTreemapMetrics,
  toTreemapRow,
  type MarketSizeMetric,
} from "../../market/marketTreemap";
import { getRawMetricValue } from "@/components/heatmap/heatmapUtils";
import type { UseMarketSnapshotResult } from "../../market/useMarketSnapshotSolid";
import {
  acquireMarketSnapshot,
  releaseMarketSnapshot,
  type MarketSnapshotEntry,
} from "./marketSnapshotHub";
import {
  defaultMarketFilters,
  filterMarketRows,
  MARKET_SORT_OPTIONS,
  resetUniverseSpecificFilters,
  type MarketFilterState,
  type MarketSortKey,
} from "../../market/marketFilters";
import { HeatmapFiltersControl } from "./heatmapFilters";
import { isRecord } from "@/utils/isRecord";

const HEATMAP_UNIVERSE: MarketUniverse = "all_equity";
const HEATMAP_CURRENCY: CurrencyCode = "INR";

const UNIVERSE_OPTIONS = MARKET_UNIVERSE_DESCRIPTORS.map(({ value, label }) => ({ value, label }));
const UNIVERSE_VALUES = new Set<string>(MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value));
// The subtitle borrows the legend's own direction phrase so the two cannot drift.
const LEGEND_DIRECTION = MARKET_COLOR_SCALE_NOTE.split(" · ")[0] ?? MARKET_COLOR_SCALE_NOTE;

/** A value this small is a genuine flat day, not a tile with a spread. */
const FLAT_EPSILON = 1e-9;
/** A real zero gets 1% of the smallest moving tile, matching the shared builder. */
const ZERO_TILE_AREA_RATIO = 0.01;

interface ImmediateTile {
  symbol: string;
  name: string;
  weight: number;
  fill: string;
  ink: string;
  detail: string;
}

function readUniverse(data: Record<string, unknown> | undefined): MarketUniverse {
  return (data?.universe ?? HEATMAP_UNIVERSE) as MarketUniverse;
}

const SORT_KEYS = new Set<string>(MARKET_SORT_OPTIONS.map((option) => option.value));
const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;
const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** The panel-owned slice of the window bag. Unknown keys (e.g. a removed
 * `colorBy` from an older build) are ignored here, not written back. */
export interface PersistedHeatmapSettings {
  universe?: MarketUniverse;
  sizeBy?: MarketSizeMetric;
  filters?: MarketFilterState;
}

export function parseHeatmapSettings(raw: unknown): PersistedHeatmapSettings {
  if (!isRecord(raw)) return {};
  const out: PersistedHeatmapSettings = {};
  const universe = typeof raw.universe === "string" && UNIVERSE_VALUES.has(raw.universe)
    ? (raw.universe as MarketUniverse)
    : undefined;
  if (universe) out.universe = universe;
  if (isMarketSizeMetric(raw.sizeBy)) out.sizeBy = raw.sizeBy;

  const rf = raw.filters;
  if (isRecord(rf)) {
    const base = defaultMarketFilters(universe ?? HEATMAP_UNIVERSE);
    out.filters = {
      ...base,
      search: typeof rf.search === "string" ? rf.search : base.search,
      capTiers: new Set(stringList(rf.capTiers)),
      priceMin: finiteOrNull(rf.priceMin),
      priceMax: finiteOrNull(rf.priceMax),
      dayChangeMin: finiteOrNull(rf.dayChangeMin),
      dayChangeMax: finiteOrNull(rf.dayChangeMax),
      mcapMinCr: finiteOrNull(rf.mcapMinCr),
      mcapMaxCr: finiteOrNull(rf.mcapMaxCr),
      rsiMin: finiteOrNull(rf.rsiMin),
      rsiMax: finiteOrNull(rf.rsiMax),
      relVolMin: finiteOrNull(rf.relVolMin),
      relVolMax: finiteOrNull(rf.relVolMax),
      aboveSma20: boolOr(rf.aboveSma20, false),
      aboveSma50: boolOr(rf.aboveSma50, false),
      aboveSma200: boolOr(rf.aboveSma200, false),
      fnoOnly: boolOr(rf.fnoOnly, false),
      sectors: stringList(rf.sectors),
      sort: typeof rf.sort === "string" && SORT_KEYS.has(rf.sort)
        ? (rf.sort as MarketSortKey)
        : base.sort,
    };
  }
  return out;
}

/** A Set is not JSON-safe; send it as an array and let the parser rebuild it. */
export function serializeFilters(filters: MarketFilterState): Record<string, unknown> {
  return { ...filters, capTiers: [...filters.capTiers] };
}

export function serializeHeatmapSettings(input: {
  universe: MarketUniverse;
  sizeBy: MarketSizeMetric;
  filters: MarketFilterState;
}): Record<string, unknown> {
  return {
    universe: input.universe,
    sizeBy: input.sizeBy,
    filters: serializeFilters(input.filters),
  };
}

function MarketHeatmapPanel(props: {
  data: Accessor<Record<string, unknown> | undefined>;
  settings?: Accessor<Record<string, unknown>>;
  onSettingsChange?: (patch: Record<string, unknown>) => void;
}) {
  const dock = useSymbolDock();
  const stored = createMemo(() => parseHeatmapSettings(props.settings?.()));
  const view = createMemo(() => readUniverse(props.data()));
  const [universe, setUniverse] = createSignal<MarketUniverse>(stored().universe ?? view());
  // A late data arrival is authoritative only when the window bag carries no
  // universe of its own — one saved value per concept.
  createEffect(on(view, (value) => {
    if (stored().universe === undefined) setUniverse(value);
  }));

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
  const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>(
    stored().sizeBy ?? DEFAULT_MARKET_SIZE_METRIC,
  );

  const currency = () => marketUniverseDescriptor(universe()).currency;
  const rows = () => snapshot.rows();
  const [filters, setFilters] = createSignal<MarketFilterState>(
    stored().filters ?? defaultMarketFilters(universe()),
  );
  const report = (patch: Record<string, unknown>) => props.onSettingsChange?.(patch);
  const patchFilters = (patch: Partial<MarketFilterState>) => {
    const next = { ...filters(), ...patch };
    setFilters(next);
    report({ filters: serializeFilters(next) });
  };
  // A late hydration or a tab switch swaps this already-mounted panel's bag.
  // Applying it here (without reporting) keeps the save path one-way.
  createEffect(on(stored, (value) => {
    if (value.universe !== undefined && value.universe !== universe()) setUniverse(value.universe);
    if (value.sizeBy !== undefined && value.sizeBy !== sizeBy()) setSizeBy(value.sizeBy);
    if (value.filters !== undefined) setFilters(value.filters);
  }));
  // One materialised row list and one ETF tally from a single pass; a second
  // `.filter` over an already-materialised array was a full extra traversal.
  const filtered = createMemo(() => {
    const list = filterMarketRows(rows(), filters());
    let etfs = 0;
    for (const row of list) if (row.etf) etfs += 1;
    return { list, etfs };
  });
  const filteredRows = createMemo(() => filtered().list);
  const etfCount = createMemo(() => filtered().etfs);
  const total = () => Math.max(snapshot.total(), rows().length);
  const formatCount = (count: number) =>
    count.toLocaleString(marketUniverseDescriptor(universe()).priceLocale);
  // The screener page and this panel share one vocabulary: a single Size by
  // control whose metric owns both tile area and colour. No local list, no
  // data-aware disable step — the registry is the only source of options.
  const metricOptions = createMemo(() => marketMetricOptions(currency()));
  const labelFor = (metric: MarketSizeMetric) =>
    metricOptions().find((option) => option.value === metric)?.label ?? metric;

  /**
   * Synchronous tiles for the window desk. ECharts is lazy-loaded, so a fresh
   * panel (or a slow module fetch) used to show the count with an empty body
   * for seconds. These tiles use the same metric/domain/zero-area rules as the
   * shared builder and are removed only once a real canvas has painted.
   */
  const immediateTiles = createMemo<{ tiles: ImmediateTile[]; flat: boolean }>(() => {
    const metric = sizeBy();
    const fmt = marketTreemapMetrics(currency()).find((m) => m.value === metric)?.fmt;
    const valid: Array<{ row: ReturnType<typeof toTreemapRow>; value: number }> = [];
    for (const row of filteredRows()) {
      const converted = toTreemapRow(row, currency());
      const value = getRawMetricValue(converted, metric);
      if (value !== null && Number.isFinite(value)) valid.push({ row: converted, value });
    }
    if (valid.length === 0) return { tiles: [], flat: false };
    const flat = valid.every((entry) => Math.abs(entry.value) <= FLAT_EPSILON);
    const domain = marketColorDomain(valid.map((entry) => entry.row), metric);
    const moving = valid
      .map((entry) => Math.abs(entry.value))
      .filter((value) => value > FLAT_EPSILON);
    const smallest = moving.length > 0 ? Math.min(...moving) : 0;
    const zeroArea = smallest > 0 ? smallest * ZERO_TILE_AREA_RATIO : 1;
    const tiles = valid
      .map(({ row, value }) => ({
        symbol: row.symbol,
        name: row.name,
        weight: Math.abs(value) > FLAT_EPSILON ? Math.abs(value) : zeroArea,
        fill: marketTileColor(metric, value, domain.min, domain.max),
        ink: marketTileTextColor(metric, value, domain.min, domain.max),
        detail: fmt ? fmt(value) : String(value),
      }))
      .sort((a, b) => b.weight - a.weight);
    return { tiles, flat };
  });
  // Every listed value is flat: there is no area/color signal to paint. Say so
  // instead of claiming "N of N" above an empty chart.
  const noSpread = createMemo(() => {
    const { tiles, flat } = immediateTiles();
    return filteredRows().length > 0 && (tiles.length === 0 || flat);
  });

  const [chartReady, setChartReady] = createSignal(false);
  let mapObserver: MutationObserver | undefined;
  let mapResizeObserver: ResizeObserver | undefined;
  let readyFrame = 0;
  const watchMap = (el: HTMLDivElement) => {
    mapObserver?.disconnect();
    mapResizeObserver?.disconnect();
    if (readyFrame) cancelAnimationFrame(readyFrame);
    readyFrame = 0;
    const check = () => {
      const canvas = el.querySelector("canvas");
      if (!canvas || readyFrame || canvas.getBoundingClientRect().width <= 0) return;
      // setOption runs in the same task as init; two frames guarantee paint.
      readyFrame = requestAnimationFrame(() => {
        readyFrame = requestAnimationFrame(() => {
          readyFrame = 0;
          setChartReady(true);
        });
      });
    };
    if (typeof MutationObserver !== "undefined") {
      mapObserver = new MutationObserver(check);
      mapObserver.observe(el, { childList: true, subtree: true });
    }
    if (typeof ResizeObserver !== "undefined") {
      mapResizeObserver = new ResizeObserver(check);
      mapResizeObserver.observe(el);
    }
    check();
  };
  createEffect(() => {
    if (filteredRows().length === 0 || noSpread()) setChartReady(false);
  });
  onCleanup(() => {
    mapObserver?.disconnect();
    mapResizeObserver?.disconnect();
    if (readyFrame) cancelAnimationFrame(readyFrame);
  });

  const staleLabel = () => {
    const age = snapshot.ageSec();
    if (age == null) return "Stale data";
    if (age < 60) return `Stale data · ${Math.round(age)}s old`;
    return `Stale data · ${Math.round(age / 60)}m old`;
  };

  const chooseUniverse = (value: string | null) => {
    if (!value || !UNIVERSE_VALUES.has(value)) return;
    const nextFilters = resetUniverseSpecificFilters(filters(), value as MarketUniverse);
    setFilters(nextFilters);
    setUniverse(value as MarketUniverse);
    report({ universe: value, filters: serializeFilters(nextFilters) });
  };
  const chooseSizeMetric = (value: string | null) => {
    if (!isMarketSizeMetric(value)) return;
    setSizeBy(value);
    report({ sizeBy: value });
  };
  const clearFilters = () => patchFilters(defaultMarketFilters(universe()));

  return (
    <Box data-testid="market-heatmap-panel" className="flex h-full min-h-0 flex-col">
      <Box className="flex-shrink-0 border-b border-fin-border" data-testid="market-heatmap-context">
        <ToolbarRow
          gap={8}
          className="min-h-8 px-2 py-1"
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
            Size by
          </Text>
          <Select
            size="xs"
            w={112}
            value={sizeBy()}
            onChange={chooseSizeMetric}
            data={metricOptions()}
            aria-label="Size the heatmap by"
            data-testid="market-heatmap-metric"
          />
          <HeatmapFiltersControl
            filters={filters()}
            rows={rows()}
            universe={universe()}
            onChange={patchFilters}
          />
          {/* Kept as one unit: a greedy flex spacer pushed the count and
              refresh onto separate rows when the toolbar wraps on narrow. */}
          <Box className="ml-auto flex items-center gap-2">
            <Text size="xs" c="dimmed" className="whitespace-nowrap" data-testid="market-heatmap-count">
              {noSpread()
                ? "No spread · 0 tiles"
                : `${formatCount(immediateTiles().tiles.length)} stocks · ${formatCount(etfCount())} ${
                    etfCount() === 1 ? "ETF" : "ETFs"
                  }`}
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
          </Box>
        </ToolbarRow>
        <Box className="px-2 pb-1" data-testid="market-heatmap-encoding-row">
          <Text size="xs" c="dimmed" className="leading-tight" data-testid="market-heatmap-encoding">
            {"Size & Colour = "}{labelFor(sizeBy())} ({LEGEND_DIRECTION}) ·{" "}
            <span data-testid="heatmap-filter-count">
              {noSpread()
                ? `0 of ${formatCount(total())} tiles`
                : `${formatCount(immediateTiles().tiles.length)} of ${formatCount(total())}`}
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
                      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-2"
                    >
                      <Text size="xs" c="dimmed">
                        {rows().length > 0
                          ? "No stocks match these filters."
                          : "No stocks in this snapshot."}
                      </Text>
                      <Button
                        size="xs"
                        variant="subtle"
                        data-testid="market-heatmap-empty-action"
                        onClick={() => (rows().length > 0 ? clearFilters() : snapshot.refresh(true))}
                      >
                        {rows().length > 0 ? "Clear filters" : "Refresh snapshot"}
                      </Button>
                    </Box>
                  }
                >
                  <Show
                    when={!noSpread()}
                    fallback={
                      <Box
                        data-testid="market-heatmap-no-spread"
                        className="flex h-full min-h-0 flex-col items-center justify-center gap-1 p-2 text-center"
                      >
                        <Text size="xs" fw={700}>No heatmap spread today</Text>
                        <Text size="xs" c="dimmed">
                          All {formatCount(filteredRows().length)} stocks are flat on{" "}
                          {labelFor(sizeBy()).toLowerCase()}. Tiles appear when values move.
                        </Text>
                      </Box>
                    }
                  >
                    <Box className="relative flex min-h-0 flex-1 flex-col">
                      {/* The shared map lazy-loads ECharts. Until its canvas has
                          actually painted, paint the same stocks synchronously
                          so the count above never sits over a blank body. */}
                      <Show when={!chartReady()}>
                        <Box
                          data-testid="market-heatmap-immediate-tiles"
                          className="absolute inset-0 z-10 flex flex-wrap content-stretch gap-[2px] overflow-hidden bg-fin-surface p-2"
                          style={{ "pointer-events": "none" }}
                        >
                          <For each={immediateTiles().tiles}>
                            {(tile) => (
                              <div
                                data-testid={`market-heatmap-tile-${tile.symbol}`}
                                class="flex min-w-[28px] grow basis-[64px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[2px] px-1 py-2 text-center"
                                style={{
                                  "flex-grow": String(tile.weight),
                                  "background-color": tile.fill,
                                  color: tile.ink,
                                }}
                                title={`${tile.name} · ${tile.detail}`}
                              >
                                <span class="w-full truncate text-ui-micro font-bold leading-tight">
                                  {tile.symbol}
                                </span>
                                <span class="w-full truncate text-ui-micro leading-tight">
                                  {tile.detail}
                                </span>
                              </div>
                            )}
                          </For>
                        </Box>
                      </Show>
                      {/* The map's own legend is built with nowrap labels; in a
                          narrow pane those clipped mid-sentence. Let the shared
                          view keep its markup while the desk wrapper wraps them. */}
                      <div
                        ref={watchMap}
                        class="flex min-h-0 flex-1 flex-col [&_[data-testid='market-map-legend']]:h-auto! [&_[data-testid='market-map-legend']]:flex-wrap! [&_[data-testid='market-map-color-direction']]:whitespace-normal! [&_[data-testid='market-map-size-note']]:whitespace-normal!"
                      >
                        <MarketMapView
                          rows={filteredRows()}
                          currency={currency()}
                          sizeBy={sizeBy()}
                          onSizeByChange={(value) => chooseSizeMetric(value)}
                          showSizeControl={false}
                          onSymbolClick={(symbol) => dock.open(symbol)}
                        />
                      </div>
                    </Box>
                  </Show>
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
              <Button
                size="xs"
                variant="subtle"
                data-testid="market-heatmap-error-retry"
                onClick={() => snapshot.refresh(true)}
              >
                Retry
              </Button>
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
  mount: (_ctx, api) => (
    <MarketHeatmapPanel
      data={api.data}
      settings={api.settings}
      onSettingsChange={api.onSettingsChange}
    />
  ),
};
