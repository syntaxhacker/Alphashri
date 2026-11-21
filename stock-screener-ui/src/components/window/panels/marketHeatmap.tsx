import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, type Accessor } from "solid-js";
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
  MARKET_SORT_OPTIONS,
  resetUniverseSpecificFilters,
  type MarketFilterState,
  type MarketSortKey,
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

const SORT_KEYS = new Set<string>(MARKET_SORT_OPTIONS.map((option) => option.value));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
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
            {"Size & Colour = "}{labelFor(sizeBy())} ({LEGEND_DIRECTION}) ·{" "}
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
                  <MarketMapView
                    rows={filteredRows()}
                    currency={currency()}
                    sizeBy={sizeBy()}
                    onSizeByChange={(value) => chooseSizeMetric(value)}
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
