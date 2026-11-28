import {
  For,
  Show,
  Suspense,
  batch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
  untrack,
  type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { useNavigate } from "@solidjs/router";
import {
  Box,
  Button,
  Badge,
  Paper,
  SegmentedControl,
  Select,
  Skeleton,
  Text,
  TextInput,
  ToolbarRow,
  Tooltip,
  ActionIcon,
  Loader,
  Indicator,
  useMediaQuery,
} from "@/ui";
import { IconAlertCircle, IconFilter, IconPlus, IconRefresh, IconSearch, IconX } from "../common/Icons";
import { formatNumberIN } from "@/utils/ui-helpers";
import { MARKET_UNIVERSES, DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import type { SortEntry, TableColumnDef as ColumnDef } from "../common/TanStackTable";
import type { MarketRow, MarketUniverse } from "../../types/marketScreener";
import { marketUniverseDescriptor } from "../../config/marketUniverses";
import {
  buildMarketFilterChips,
  countActiveMarketFilters,
  defaultMarketFilters,
  mergeMoverPresetFilters,
  filterOnlyMarketRows,
  marketSectors,
  countByCapTier,
  resetUniverseSpecificFilters,
  sortMarketRows,
  universeHasFno,
  clearMarketFilterChip,
  type MarketFilterState,
  type MarketSortKey,
} from "./marketFilters";
import { buildMarketColumns } from "./marketColumns";
import {
  applyMarketNarrowLayout,
  MARKET_NARROW_PRIMARY_WIDTH,
  MARKET_PRIMARY_IDS,
  narrowMarketColumns,
  useMarketNarrow,
} from "./marketNarrowLayout";
import { usePatternSummary } from "./usePatternSummary";
import { alpha, PRIMARY } from "@/ui/palette";
import { MarketFilterRail } from "./MarketFilterRail";
import {
  MARKET_VIEW_OPTIONS,
  VIS_OPTIONS,
  VIS_RENDERERS,
  normalizeMarketView,
  type MarketViewMode,
  type VisMode,
} from "./MarketMapView";
import {
  DEFAULT_HEATMAP_SIZE_METRIC,
  DEFAULT_MARKET_SIZE_METRIC,
  isMarketSizeMetric,
  marketMetricOptions,
  NARROW_TREEMAP_MAX_WIDTH,
  type MarketSizeMetric,
} from "./marketTreemap";
import { marketUniverseToValueMarket } from "@/config/valueMarketMapping";
import { TanStackTable } from "../common/TanStackTable";
import { FilterStatusRow } from "../common/FilterStatusRow";
import { useTablePrefs } from "../common/useTablePrefs";
import { ChartDockOutlet } from "../common/ChartDockOutlet";
import { isLiveUniverse, useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { MarketBreadthStrip } from "./MarketBreadthStrip";
import { useSymbolDock } from "../common/symbolDockContext";
import { defaultMarketConfig, useMarketConfig, type MarketConfigValue } from "./useMarketConfig";
import { fetchSectionScan, type SectionScanResult } from "../../api/sections";
import { useSectionsConfig } from "../../state/sections/config";

// Movers owns the whole dashboard module; keep it out of the Market chunk.
const DashboardView = lazy(() =>
  import("../screener/DashboardView").then((m) => ({ default: m.DashboardView })),
);
// Value owns its own scan pipeline; load it only when the Value view is opened.
const ValueView = lazy(() =>
  import("../value/ValuePanel").then((m) => ({ default: m.ValuePanel })),
);
// Sections are a separate feature surface: neither its table nor its manager
// belongs in the Market chunk. Both are activated only from the Sections tab.
const SectionTable = lazy(() =>
  import("./SectionTable").then((m) => ({ default: m.SectionTable })),
);
const SectionManagerModal = lazy(() =>
  import("./SectionManagerModal").then((m) => ({ default: m.SectionManagerModal })),
);

const SECTION_TABS: { value: string; label: string }[] = [
  ...MARKET_VIEW_OPTIONS,
  { value: "sections", label: "Sections" },
];
type ScreenerTab = MarketViewMode | "sections";

// Only the two treemaps size their tiles. Every other Vis mode owns its own
// scale (ranks, periods, coefficients), so a Size by control there is a lie.
const SIZE_BY_VIS_MODES: ReadonlySet<VisMode> = new Set(["heatmap", "sector"]);

// The config store hydrates its defaults even when no row is saved, so a bare
// default payload carries the legacy `change_pct` size metric. Only a payload
// that actually differs from the defaults is a persisted user choice.
function hasPersistedMarketConfig(value: MarketConfigValue): boolean {
  const key = (config: MarketConfigValue) =>
    JSON.stringify(config.filters, (_k, v) => (v instanceof Set ? [...v] : v));
  const baseline = defaultMarketConfig({ universe: value.universe, view: value.view });
  return value.colorBy !== baseline.colorBy || key(value) !== key(baseline);
}

function MoversPanel(props: {
  universe: string;
  selectedSymbol: string | null;
  onOpenSymbol: (symbol: string) => void;
  onOpenScan?: (panelId: string, symbols: string[]) => void;
}) {
  let tree!: JSX.Element;
  // Solid leaves its effect queue null when a Suspense is constructed outside a
  // reactive root (a caller can build this element eagerly); batch seeds it.
  batch(() => {
    tree = (
      <Suspense
        fallback={
          <Box
            data-testid="market-movers-loading"
            className="flex items-center justify-center gap-2 py-6 border border-fin-border rounded-sm bg-fin-surface"
          >
            <Loader size={14} />
            <Text size="xs" c="dimmed">
              Loading movers…
            </Text>
          </Box>
        }
      >
        <DashboardView
          embedded
          universe={props.universe}
          selectedSymbol={props.selectedSymbol}
          onOpenSymbol={props.onOpenSymbol}
          onOpenScan={props.onOpenScan}
        />
      </Suspense>
    );
  });
  return tree;
}

/**
 * Owns the Sections tab's one request per refresh. Mounting is activation: no
 * interval, no polling — a new scan happens only on mount, market change or the
 * explicit Refresh button.
 */
function SectionsView(props: {
  market: "india" | "america";
  onOpenSymbol?: (symbol: string) => void;
}) {
  const { config } = useSectionsConfig();
  const activeSections = createMemo(() =>
    [...config().sections]
      .filter((section) => section.enabled)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
  );
  // TradingView's public scanner currently returns delayed_streaming_* for all
  // rows. Default to accepting it so sections are useful, with the delay shown
  // in the strip and on every table; users can opt into streaming-only data.
  const [allowDelayed, setAllowDelayed] = createSignal(true);
  const [result, setResult] = createSignal<SectionScanResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [managerOpen, setManagerOpen] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const load = async () => {
    const definitions = untrack(activeSections);
    if (definitions.length === 0) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSectionScan(props.market, definitions, untrack(allowDelayed));
      if (!disposed) setResult(next);
    } catch (cause) {
      if (!disposed) {
        setError(cause instanceof Error ? cause.message : "Failed to load sections");
        setResult(null);
      }
    } finally {
      if (!disposed) setLoading(false);
    }
  };

  createEffect(on(() => props.market, () => void load()));

  return (
    <Box
      data-testid="market-sections-region"
      className="flex-1 min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden"
    >
      <ToolbarRow
        gap={8}
        wrap
        data-testid="market-sections-toolbar"
        className="flex-shrink-0 px-2 py-1 border border-fin-border rounded-sm bg-fin-surface"
      >
        <Text size="xs" c="dimmed" className="whitespace-nowrap">
          Signal sections
        </Text>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconRefresh size={12} />}
          onClick={() => void load()}
          disabled={loading() || activeSections().length === 0}
          data-testid="market-sections-refresh"
        >
          Refresh
        </Button>
        <Button
          size="xs"
          variant={allowDelayed() ? "light" : "subtle"}
          aria-pressed={allowDelayed()}
          onClick={() => setAllowDelayed((value) => !value)}
          data-testid="market-sections-allow-delayed"
        >
          Include delayed
        </Button>
        <Box className="flex-1 min-w-0" />
        <Show when={(result()?.delayed_rows ?? 0) > 0}>
          <Badge size="xs" variant="light" color="warning" data-testid="market-sections-delayed">
            {result()!.delayed_rows} delayed
          </Badge>
        </Show>
        <Text size="xs" c="dimmed" className="font-numeric whitespace-nowrap">
          {result()?.row_count ?? 0} rows
        </Text>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconPlus size={12} />}
          onClick={() => setManagerOpen(true)}
          data-testid="market-sections-add"
        >
          Add section
        </Button>
      </ToolbarRow>

      <Show when={result()?.note}>
        {(note) => (
          <Box
            role="note"
            data-testid="market-sections-note"
            className="flex-shrink-0 px-2 py-1 border border-fin-border rounded-sm bg-fin-surface"
          >
            <Text size="xs" c="dimmed">
              {note()}
            </Text>
          </Box>
        )}
      </Show>

      <Show
        when={error() === null}
        fallback={
          <Paper
            elevation={0}
            role="alert"
            data-testid="market-sections-error"
            className="flex-1 border border-fin-border border-l-[3px] border-l-fin-negative rounded-sm bg-fin-surface flex flex-col items-center justify-center gap-2 p-6 text-center"
          >
            <IconAlertCircle size={24} />
            <Text size="sm" fw={600}>
              Couldn’t load signal sections
            </Text>
            <Text size="xs" c="dimmed" data-testid="market-sections-error-message">
              {error()}
            </Text>
            <Button
              size="sm"
              variant="outline"
              leftSection={<IconRefresh size={12} />}
              onClick={() => void load()}
              data-testid="market-sections-retry"
            >
              Retry
            </Button>
          </Paper>
        }
      >
        <Show
          when={activeSections().length > 0}
          fallback={
            <Paper
              elevation={0}
              role="note"
              data-testid="market-sections-empty"
              className="flex-1 border border-fin-border rounded-sm bg-fin-surface flex items-center justify-center p-4"
            >
              <Text size="xs" c="dimmed">
                No enabled sections yet — add one to scan for signals.
              </Text>
            </Paper>
          }
        >
          {/* Bounded rows make each section table the only scrollport. An
              overflow-y-auto grid here competes with the table's wheel and
              stalls scrolling on the first data load. */}
          <Box
            data-testid="market-sections-grid"
            className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 auto-rows-[minmax(0,1fr)] gap-2 overflow-hidden"
          >
            <For each={activeSections()}>
              {(section) => {
                // One scan payload feeds every card. Filter it to this section's
                // own signal once: the heading count and the rendered table rows
                // must be the same set, not a count over a narrower set than the
                // table shows. The toolbar count stays global.
                const matchedRows = createMemo(() => {
                  const rows = result()?.rows;
                  return rows ? rows.filter((row) => row.signals?.[section.id] === true) : null;
                });
                const matchCount = createMemo(() => matchedRows()?.length ?? null);
                return (
                  <Paper
                    elevation={0}
                    data-testid={`section-card-${section.id}`}
                    className="min-w-0 min-h-0 border border-fin-border rounded-sm bg-fin-surface overflow-hidden flex flex-col"
                  >
                    <ToolbarRow
                      gap={8}
                      wrap={false}
                      data-testid={`section-card-heading-${section.id}`}
                      className="flex-shrink-0 px-2 py-1 border-b border-fin-border"
                    >
                      <Text
                        component="h3"
                        size="sm"
                        fw={700}
                        truncate
                        title={section.name}
                        className="text-ui-label min-w-0"
                        data-testid={`section-name-${section.id}`}
                      >
                        {section.name}
                      </Text>
                      <Show when={matchCount() !== null}>
                        <Text
                          size="xs"
                          c="dimmed"
                          className="text-ui-micro font-numeric whitespace-nowrap"
                          data-testid={`section-card-matches-${section.id}`}
                        >
                          {matchCount()} {matchCount() === 1 ? "match" : "matches"}
                        </Text>
                      </Show>
                    </ToolbarRow>
                    <Suspense fallback={<Skeleton h={120} visible />}>
                      <SectionTable
                        section={section}
                        rows={matchedRows() ?? []}
                        loading={loading()}
                        error={null}
                        dense
                        borderless
                        onOpenSymbol={props.onOpenSymbol}
                      />
                    </Suspense>
                  </Paper>
                );
              }}
            </For>
          </Box>
        </Show>
      </Show>

      <Show when={managerOpen()}>
        <Suspense fallback={null}>
          <SectionManagerModal opened={managerOpen()} onClose={() => setManagerOpen(false)} />
        </Suspense>
      </Show>
    </Box>
  );
}

const NARROW_LOCKED_COLUMNS: string[] = [...MARKET_PRIMARY_IDS];

const STALE_AFTER_MS = 15 * 60 * 1000;
const STALE_CLOCK_MS = 30 * 1000;
const UNIVERSE_OPTIONS = MARKET_UNIVERSES.map((o) => ({ value: o.value, label: o.label }));

// The in-app chart has two data paths: the NSE dock for Indian listings and the
// US provider (selected by `?market=usa`) for NASDAQ/NYSE/AMEX. The symbol is
// passed through untouched — `BRK.B` stays `BRK.B` in the URL.
const USA_CHART_EXCHANGES = new Set(["nasdaq", "nyse", "amex"]);
const normalizeExchange = (exchange: string | undefined): string =>
  String(exchange ?? "").trim().toLowerCase();

const DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** First-load sort. Not written by the store until the user actually clicks a header. */
const DEFAULT_TABLE_SORTING: SortEntry[] = [{ id: "market_cap_cr", desc: true }];

/**
 * The table prefs own the sort; the map dropdown only mirrors it when the primary
 * sorter names a metric the dropdown can express. Ascending is expressible only
 * for day change and symbol, so other ascending sorters leave the dropdown be.
 */
export function sortEntryToMarketSort(sorting: SortEntry[]): MarketSortKey | null {
  const primary = sorting[0];
  if (!primary) return null;
  switch (primary.id) {
    case "market_cap_cr":
      return primary.desc ? "mcap_desc" : null;
    case "day_change":
    case "change":
      return primary.desc ? "day_desc" : "day_asc";
    case "rsi":
      return primary.desc ? "rsi_desc" : null;
    case "relative_volume":
      return primary.desc ? "relvol_desc" : null;
    case "perf_w":
      return primary.desc ? "perf_w_desc" : null;
    case "perf_1m":
      return primary.desc ? "perf_1m_desc" : null;
    case "pos_52w":
      return primary.desc ? "pos_52w_desc" : null;
    case "symbol":
      return primary.desc ? null : "symbol_asc";
    default:
      return null;
  }
}

/**
 * Pure inverse of `sortEntryToMarketSort`. Kept as the documented mapping, but
 * the panel no longer uses it to drive the table: the map dropdown is local to
 * the map and the table sort has a single owner (table.market.grid).
 */
export function marketSortToSortEntry(sort: MarketSortKey): SortEntry | null {
  switch (sort) {
    case "mcap_desc":
      return { id: "market_cap_cr", desc: true };
    case "day_desc":
      return { id: "day_change", desc: true };
    case "day_asc":
      return { id: "day_change", desc: false };
    case "rsi_desc":
      return { id: "rsi", desc: true };
    case "relvol_desc":
      return { id: "relative_volume", desc: true };
    case "perf_w_desc":
      return { id: "perf_w", desc: true };
    case "perf_1m_desc":
      return { id: "perf_1m", desc: true };
    case "pos_52w_desc":
      return { id: "pos_52w", desc: true };
    case "symbol_asc":
      return { id: "symbol", desc: false };
    default:
      return null;
  }
}

function isSnapshotStale(asOf: string | null, nowMs: number): boolean {
  if (!asOf) return false;
  const parsed = Date.parse(asOf);
  if (Number.isNaN(parsed)) return false;
  return nowMs - parsed > STALE_AFTER_MS;
}

// Isolated memo boundary: chips/count/toolbar re-render on every filter click,
// but the 496-row grid must not re-reconcile until its `data` actually changes
// (i.e. the deferred pass commits). Without this, the synchronous commit that
// carries the chip/count text also re-renders every row.
export function MarketGrid(props: {
  data: MarketRow[];
  columns: ColumnDef<MarketRow>[];
  narrow: boolean;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onRowClick: (row: MarketRow) => void;
  getRowStyle: (row: MarketRow) => JSX.CSSProperties | undefined;
  getRowTestId: (row: MarketRow) => string;
  onVisibleRowsChange?: (rows: MarketRow[]) => void;
  onSortedRowsChange?: (rows: MarketRow[]) => void;
  /** A preset owns the ordering; the grid must not re-sort the data it is given. */
  presetOwnsOrder?: boolean;
}) {
  const { prefs, setSorting, setColumnPrefs } = useTablePrefs("market.grid");
  // Empty saved prefs keep the historical first-load order; the store writes
  // only after a real sort change, so the default is never persisted on mount.
  // `presetOwnsOrder` is the third state: a mover preset whose sort has no
  // table column (volume, gap, range/ATR, 52W distances) clears the table sort
  // so the pre-sorted `data` order stands. Without it the mcap fallback silently
  // re-sorted those presets and three of them rendered identical rows.
  const sorting = (): SortEntry[] => {
    if (props.presetOwnsOrder) return [];
    return prefs().sorting.length > 0 ? prefs().sorting : DEFAULT_TABLE_SORTING;
  };
  return (
    <Box
      data-market-narrow={props.narrow ? "true" : undefined}
      className="flex min-w-0 min-h-0 flex-1 flex-col"
    >
      <Show when={props.narrow}>
        {/* The table scrolls under the identity column; pin it in both the
            header and body so a row can always be named while scanning LTP. */}
        <style>{`
          [data-market-narrow="true"] th:first-of-type,
          [data-market-narrow="true"] td:first-of-type {
            position: sticky !important;
            left: 0;
          }
          [data-market-narrow="true"] th:first-of-type {
            z-index: 3;
            background-color: var(--color-fin-surface-alt) !important;
            box-shadow: 1px 0 0 0 var(--color-fin-border);
          }
          [data-market-narrow="true"] td:first-of-type {
            z-index: 2;
            background-color: var(--color-fin-surface) !important;
            box-shadow: 1px 0 0 0 var(--color-fin-border);
          }
        `}</style>
      </Show>
      <TanStackTable
        data={props.data}
        columns={props.columns}
        dataTestId="market-grid"
        ariaLabel="Market screener results"
        rowWindowSize={80}
        fillContainer
        dense
        minTableWidth={props.narrow ? MARKET_NARROW_PRIMARY_WIDTH : 1000}
        enableSorting
        stickyHeader
        tableId="market.grid"
        enableColumnControls
        // A saved wide order must not push NAME ahead of the narrow metrics,
        // but an empty order still lets the default-hidden extras stay hidden.
        columnPrefs={{
          order: props.narrow ? [] : prefs().order,
          hidden: prefs().hidden,
        }}
        onColumnPrefsChange={({ order, hidden }) => setColumnPrefs({ order, hidden })}
        // SYMBOL identifies the row; the other three are the narrow reading
        // order, so hiding one would leave the first screen unreadable.
        lockVisible={props.narrow ? NARROW_LOCKED_COLUMNS : ["symbol"]}
        sorting={sorting()}
        onSortingChange={setSorting}
        onRowClick={props.onRowClick}
        getRowStyle={props.getRowStyle}
        getRowTestId={props.getRowTestId}
        onVisibleRowsChange={props.onVisibleRowsChange}
        onSortedRowsChange={props.onSortedRowsChange}
        emptyMessage={
          props.hasActiveFilters ? "No rows match the current filters" : "No market data"
        }
        emptyAction={
          props.hasActiveFilters ? (
            <Button
              size="xs"
              variant="subtle"
              onClick={props.onResetFilters}
              data-testid="market-empty-reset"
            >
              Reset filters
            </Button>
          ) : undefined
        }
      />
    </Box>
  );
}

export interface MarketScreenerPanelProps {
  initialView?: MarketViewMode;
  onViewChange?: (view: MarketViewMode) => void;
  onOpenScan?: (panelId: string, symbols: string[]) => void;
  /** Symbols captured from a Dashboard "Open scan" — the table narrows to these names. */
  symbolAllowlist?: string[] | null;
  /** Clears the captured symbols (universe change / leaving the Market tab). */
  onClearSymbolAllowlist?: () => void;
  /**
   * Wire layout override. `"columns"` (the default) requests `columns-v1`;
   * `"json"` requests the legacy rows envelope. Tests pass this explicitly.
   */
  wireFormat?: "columns" | "json";
}

export function MarketScreenerPanel(props: MarketScreenerPanelProps = {}) {
  const [universe, setUniverse] = createSignal<MarketUniverse>(DEFAULT_MARKET_UNIVERSE);
  const [search, setSearch] = createSignal("");
  const [filters, setFilters] = createSignal<MarketFilterState>(defaultMarketFilters());
  const [railCollapsed, setRailCollapsed] = createSignal(false);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<MarketViewMode>(normalizeMarketView(props.initialView));
  // Sections is an overlay tab, not a MarketViewMode: the saved-config and URL
  // vocabularies stay unchanged, and leaving the tab restores the previous view.
  const [sectionsActive, setSectionsActive] = createSignal(false);
  const activeTab = (): ScreenerTab => (sectionsActive() ? "sections" : viewMode());
  // The Vis tab renders through the registry. The selector writes this signal;
  // it is intentionally local state — a viz choice is not a saved config, and
  // must never echo back through save()/scheduleSave().
  const [visMode, setVisMode] = createSignal<VisMode>(VIS_OPTIONS[0]!.value);
  // The full-snapshot heatmap needs tile areas that vary enough for the
  // treemap's label policy to keep names visible; day change makes ~3600 tiles
  // nearly equal and the map becomes an unlabelled colour field. Saved config
  // still overrides this below.
  const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>(DEFAULT_HEATMAP_SIZE_METRIC);
  // Value is a view, not a separate page: every Market filter lives in this
  // component's signals, so switching back restores the table as it was.
  const showMarketChrome = () =>
    viewMode() !== "movers" && viewMode() !== "value" && !sectionsActive();
  const [selectedSymbol, setSelectedSymbol] = createSignal<string | null>(null);
  const dock = useSymbolDock();
  const navigate = useNavigate();
  // Shares the same ref-counted store instance as MarketGrid. The table's
  // TanStack sort is the single source of truth; the map/snapshot enum is derived
  // from it below (one-way) instead of being bridged in both directions.
  const {
    prefs: tablePrefs,
    setSorting: setTableSorting,
  } = useTablePrefs("market.grid");

  /**
   * A preset's ordering has to reach the grid. TanStack owns ordering from
   * `prefs().sorting` and re-sorts whatever `data` it is handed, so setting only
   * `filters.sort` left different presets rendering identical row order.
   *
   * Two cases:
   * - the sort maps to a real column (day/mcap/relvol/...) -> drive the table;
   * - it does not (volume, gap, range/ATR, 52W distances have no column) ->
   *   CLEAR the table's sorting so the already-sorted `data` order stands.
   */
  const [presetOwnsOrder, setPresetOwnsOrder] = createSignal(false);
  const applyPreset = (patch: Partial<MarketFilterState>) => {
    const { sort, ...bounds } = patch;
    // A preset owns both bounds and order; showing the table makes the applied
    // result visible instead of leaving the user on the Value/Vis surface.
    if (sort) setViewMode("table");
    if (Object.keys(bounds).length > 0) {
      setFilters((current) => mergeMoverPresetFilters(current, bounds));
    }
    if (!sort) {
      setPresetOwnsOrder(false);
      return;
    }
    const entry = marketSortToSortEntry(sort);
    // A column the grid can sort by -> drive the table. Otherwise the grid stops
    // sorting and `filteredRows` orders by `filters.sort`, so that has to be set
    // too — clearing the table alone left the previous sort in place, which is
    // why Most Active / Top Turnover / Range Expansion all rendered mcap order.
    setPresetOwnsOrder(entry == null);
    if (entry) setTableSorting([entry]);
    // Always record it: with no table column this is the only thing that orders
    // the rows, and with one it keeps the map/snapshot enum in step.
    patchFilters({ sort });
  };

  // Only the toolbar's stale badge subscribes to the clock: a snapshot ages
  // past 15 minutes while the tab sits open and no new data will arrive to
  // re-run the memo, so `Date.now()` cannot be read inside it.
  const [nowMs, setNowMs] = createSignal(Date.now());
  createEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), STALE_CLOCK_MS);
    onCleanup(() => clearInterval(id));
  });

  let drawerEl: HTMLDivElement | undefined;
  let toggleEl: HTMLElement | undefined;

  // Saved config: `?view=` wins when present, saved state is the fallback for a
  // bare `/screener`, defaults otherwise. Hydration is applied in one batch and
  // `prevUniverse` is moved first — see the reset effect below.
  let prevUniverse = universe();
  const applySavedConfig = (value: MarketConfigValue) => {
    // A saved `fnoOnly` can only have come from an India session. In a universe
    // without F&O every row carries `fno:false`, so leaving it set would hide the
    // whole snapshot behind a toggle the rail does not even render. Clear it at
    // the boundary so state, toggle, chip and filter cannot disagree.
    const restoredFilters = universeHasFno(value.universe)
      ? value.filters
      : { ...value.filters, fnoOnly: false };
    batch(() => {
      // Announce the hydrated universe to the reset effect before the signal
      // moves: restoring nifty500 must not wipe the sectors restored with it.
      prevUniverse = value.universe;
      setUniverse(value.universe);
      setFilters(restoredFilters);
      setViewMode(value.view);
      // The saved field is still called `colorBy` on the wire; it now seeds the
      // single sizing metric, not a colour choice. A bare defaults payload is
      // the store's no-saved-row fallback, not a user choice, so it must not
      // undo the heatmap's market-cap default.
      if (hasPersistedMarketConfig(value)) {
        setSizeBy(value.colorBy ?? DEFAULT_MARKET_SIZE_METRIC);
      }
    });
  };
  const savedConfig = useMarketConfig({
    // `?view=` is lossy on the way in: the shell parses a missing param to
    // "table" and never writes `?view=table` back, so `table` cannot be told
    // apart from a bare link. Only a non-default view is a present-tense
    // instruction; everything else falls back to the saved layout.
    urlView: props.initialView && props.initialView !== "table" ? props.initialView : undefined,
    onApply: applySavedConfig,
  });
  const savedConfigError = () => savedConfig.error();
  const savedConfigFailed = () =>
    savedConfigError() === "not_saved" || savedConfigError() === "invalid";
  const wireFormat = (() => {
    if (props.wireFormat) return props.wireFormat === "json" ? undefined : "columns";
    // `?wire=json` is the rollback switch: force the legacy rows envelope
    // without a rebuild.
    if (typeof window === "undefined") return "columns";
    return new URLSearchParams(window.location.search).get("wire") === "json"
      ? undefined
      : "columns";
  })();
  // Latch the one-way "config settled" fact. Reading `savedConfig.hydrated()`
  // directly inside the snapshot `enabled` gate would track the store's version
  // signal, so every filter edit (which notifies the store) would abort and
  // re-issue the full snapshot. The latch is set once and never flips back.
  const [configReady, setConfigReady] = createSignal(false);
  createEffect(() => {
    if (savedConfig.hydrated()) setConfigReady(true);
  });
  // The symbol cell opens the dock directly (it stops row-click propagation),
  // so the list must follow the dock or the chart's row never highlights and
  // the arrow-key handler has no anchor.
  createEffect(() => {
    const shown = dock.symbol?.();
    if (shown && shown !== selectedSymbol()) setSelectedSymbol(shown);
  });

  /** One path for selection affordances: row, symbol text, map tile, keyboard.
   *  The chart icon routes separately by exchange (see `openChart`). */
  const selectAndOpen = (symbol: string) => {
    setSelectedSymbol(symbol);
    dock.open(symbol);
  };

  // The chart icon picks the data provider from the row's exchange. US rows
  // navigate to the route that selects the US provider; everything else keeps
  // the existing dock (row/text selection still goes through `selectAndOpen`).
  const openChart = (symbol: string, exchange: string | undefined) => {
    if (USA_CHART_EXCHANGES.has(normalizeExchange(exchange))) {
      navigate(`/chart/${encodeURIComponent(symbol)}?market=usa`);
      return;
    }
    dock.open(symbol);
  };
  const isNarrow = useMediaQuery("(max-width: 1023px)");
  const isWide = useMediaQuery("(min-width: 1400px)");
  // Sub-900 results lead with the four metrics a row cannot be read without.
  const narrow = useMarketNarrow();
  // The Vis toolbar shares the treemap's narrow threshold: below it the helper
  // label is dropped and controls wrap into their own rows instead of colliding.
  const visToolbarCompact = useMediaQuery(`(max-width: ${NARROW_TREEMAP_MAX_WIDTH - 1}px)`);

  const { rows, total, updateMode, asOf, isLoading, error, refresh, stale: cachedStale, ageSec, warming } =
    useMarketSnapshotSolid(universe, {
      // Wait for `market.filters` so the first snapshot is the saved universe,
      // not defaults followed by a second fetch when hydration lands.
      enabled: () => viewMode() !== "value" && !sectionsActive() && configReady(),
      deferCacheUntilEnabled: true,
      wireFormat,
    });

  // Filters belong to one universe's snapshot; carrying them across a universe
  // switch silently hides every row of the new universe.
  createEffect(() => {
    const u = universe();
    // Hydration advances `prevUniverse` to the restored universe inside the same
    // batch, so this comparison is already false for the restore write: the
    // saved sectors survive. Firing here would reset them.
    if (u !== prevUniverse) {
      prevUniverse = u;
      // Keep the unit-neutral conditions (day/RSI/relvol/SMA/sort); drop every
      // bound whose unit or vocabulary belonged to the previous universe.
      setFilters((f) => resetUniverseSpecificFilters(f, u));
      setSearch("");
      // A symbol allowlist belongs to the universe it was captured in — a
      // universe switch would silently hide every row, so clear it.
      props.onClearSymbolAllowlist?.();
    }
  });

  // Autosave: one effect owns every persisted field. The first run is the mount
  // echo of the defaults (and of the URL view) — skipping it is what keeps the
  // latch open long enough for the GET to apply. Any later change, including one
  // that lands mid-GET, closes the latch in the store and is buffered there
  // until hydration settles.
  createEffect(
    on(
      () => ({
        universe: universe(),
        filters: filters(),
        // `search` is session-local by design and never travels.
        view: viewMode(),
        // Wire field name is unchanged; the value is the sizing metric.
        colorBy: sizeBy(),
      }),
      (value) => savedConfig.save({ ...value }),
      { defer: true },
    ),
  );

  // Filters/search drive the table directly — Solid's keyed rows only
  // reconcile what changed, so no deferred copies are needed. Filter and sort
  // are separate memos: the sort re-runs only when the filtered set (or the
  // sort key) changes.
  // The symbol allowlist (captured from a Dashboard "Open scan") narrows the
  // snapshot to exactly those names — absent/empty leaves every row visible.
  const allowlisted = createMemo(() => {
    const list = props.symbolAllowlist;
    return list && list.length > 0 ? new Set(list) : null;
  });
  const filteredRows = createMemo(() => {
    const f = filters();
    return sortMarketRows(
      filterOnlyMarketRows(rows(), {
        ...f,
        search: search(),
        // Same predicate as the rail toggle and the chip builder: an F&O-less
        // universe has no `fno` rows, so an inherited flag must never filter.
        fnoOnly: f.fnoOnly && universeHasFno(universe()),
      }).filter((row) => allowlisted() == null || allowlisted()!.has(row.symbol)),
      f.sort,
    );
  });
  // The sorted set has the same membership as the filtered one, so reuse it
  // instead of walking all ~3,200 rows a second time per filter change.
  const matchCount = createMemo(() => filteredRows().length);
  const chips = createMemo(
    () => buildMarketFilterChips({ ...filters(), search: search() }, universe()),
  );
  const activeCount = createMemo(
    () => countActiveMarketFilters({ ...filters(), search: search() }, universe()),
  );
  const sectors = createMemo(() => marketSectors(rows()));
  const tierCounts = createMemo(() => countByCapTier(rows()));

  // The PATTERNS column is fed from the window the table actually mounts:
  // ~80 rows, one batch lookup, never the ~3,200-row snapshot.
  const [visibleRows, setVisibleRows] = createSignal<MarketRow[]>([]);
  // The table owns header sorting; `filteredRows` only mirrors the subset of
  // sorters that map to `filters.sort`. Arrow stepping must follow what the
  // user sees, not the pre-table order, or one press can skip several rows.
  const [sortedRows, setSortedRows] = createSignal<MarketRow[]>([]);
  const patterns = usePatternSummary(
    () => visibleRows().map((row) => row.symbol),
    () => universe(),
  );

  // The rail's price/MCAP units and cap-tier labels follow the active universe.
  const currency = createMemo(() => marketUniverseDescriptor(universe()).currency);

  // Isolate the one filter that changes the column list. Reading `filters()`
  // directly in the columns memo rebuilt all 16 column defs on every bound
  // keystroke, which re-ran the table's sort/window/prefs memos and re-rendered
  // the visible rows even though the column set had not changed.
  const hideSector = createMemo(() => filters().sectors.length > 0);
  const columns = createMemo(() => {
    const built = buildMarketColumns({
      onSymbolOpen: selectAndOpen,
      onChartOpen: openChart,
      // A pinned sector makes the column constant; it carries no information.
      hideSector: hideSector(),
      // Read through the signal: cells re-render when the lookup lands without
      // rebuilding the column list (a rebuild would remount every row).
      patternsFor: (symbol) => patterns.summary().get(symbol),
      // Drives the MCAP header's unit; cells still read each row's own currency.
      universe: universe(),
      narrow: narrow(),
    });
    return applyMarketNarrowLayout(narrowMarketColumns(built, narrow()), narrow());
  });
  const stale = createMemo(() => cachedStale() || isSnapshotStale(asOf(), nowMs()));
  const staleHint = () => {
    const age = ageSec();
    if (age != null && age < 900) {
      return `Snapshot is ${Math.round(age)}s old — refreshing in the background`;
    }
    return `Snapshot is older than 15 minutes (as of ${asOf() ?? "unknown"})`;
  };
  const hasActiveFilters = () => chips().length > 0;

  const patchFilters = (patch: Partial<MarketFilterState>) =>
    setFilters((f) => ({ ...f, ...patch }));

  // One-way: the table owns the sort, the map/snapshot only need a MarketSortKey.
  // Mirror table -> filters.sort when the table sort actually changes. The stable
  // signature keeps hydration of an empty config (and the map's own writes) from
  // firing a redundant patch. `untrack` keeps the effect dependent only on that
  // signature, not on the table store's version signal (which bumps on hydrate
  // and on our own writes) — the re-entrancy class fixed in chartPatterns.ts.
  const tableSortForMap = createMemo(() =>
    JSON.stringify(
      (tablePrefs().sorting.length > 0 ? tablePrefs().sorting : DEFAULT_TABLE_SORTING).map(
        (s) => [s.id, s.desc],
      ),
    ),
  );
  // The table-prefs GET can win the race against the saved market.filters GET.
  // A `patchFilters` before configReady() closes the config store's latch, so
  // the restored universe and every filter are discarded and a mount-default
  // PUT overwrites them. Seeding with the default signature keeps an empty prefs
  // object from clobbering the filters' own restored sort.
  let appliedTableSort: string | null = JSON.stringify(
    DEFAULT_TABLE_SORTING.map((s) => [s.id, s.desc]),
  );
  createEffect(() => {
    const signature = tableSortForMap();
    if (!configReady() || signature === appliedTableSort) return;
    const sorting = untrack(() => tablePrefs().sorting);
    if (sorting.length === 0) return;
    appliedTableSort = signature;
    const mapped = sortEntryToMarketSort(sorting);
    // Ascending RSI (and any other direction without an enum) maps to null.
    // Skip it: the map keeps its last defined sort instead of becoming null.
    if (mapped) patchFilters({ sort: mapped });
  });

  const resetFilters = () => {
    setFilters(defaultMarketFilters());
    setSearch("");
  };

  const removeChip = (key: string) => {
    if (key === "search") {
      setSearch("");
      return;
    }
    // One owner for chip removal: `clearMarketFilterChip` covers every key,
    // including the value-filter chips and the deep-value preset, so this no
    // longer needs a parallel switch that silently ignored unknown keys.
    setFilters((f) => clearMarketFilterChip(f, key));
  };

  const handleToggleRail = (event?: MouseEvent) => {
    if (event?.currentTarget) toggleEl = event.currentTarget as HTMLElement;
    if (isNarrow()) {
      setDrawerOpen((open) => !open);
    } else {
      setRailCollapsed((collapsed) => !collapsed);
    }
  };

  const closeDrawer = () => setDrawerOpen(false);

  // The drawer only exists below 1024px. If the viewport grows while it is up,
  // the `Show` unmounts it with focus inside — close first so focus is restored.
  createEffect(() => {
    if (!isNarrow() && drawerOpen()) closeDrawer();
  });
  // Opening Value must not leave a modal filter drawer floating above it.
  createEffect(() => {
    if ((viewMode() === "value" || sectionsActive()) && drawerOpen()) closeDrawer();
  });

  const focusablesInDrawer = (): HTMLElement[] => {
    if (!drawerEl) return [];
    return Array.from(drawerEl.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE));
  };

  // A modal drawer must own focus: move it in on open, hand it back to the
  // toggle on close, and keep Tab inside while it is up. Without this the
  // pointer is the only way in or out below 1024px.
  createEffect(
    on(drawerOpen, (open, wasOpen) => {
      if (open) {
        (focusablesInDrawer()[0] ?? drawerEl)?.focus();
        return;
      }
      if (!wasOpen) return;
      (toggleEl ?? document.querySelector<HTMLElement>('[data-testid="market-rail-toggle"]'))?.focus();
    }),
  );

  createEffect(() => {
    if (!drawerOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // The preset gallery is portalled out of this drawer and owns both Tab
      // and Escape while it is up.
      if (document.querySelector('[data-testid="market-preset-gallery"]')) return;
      if (event.key === "Escape") {
        // The gallery's own Escape handler closes only the gallery. The event
        // target stays inside the gallery subtree even after its close path
        // unmounts it.
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest('[data-testid="market-preset-gallery"]')
        ) {
          return;
        }
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusablesInDrawer();
      if (items.length === 0) {
        event.preventDefault();
        drawerEl?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !drawerEl?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  const showWarmingHint = () =>
    universe() === "all_equity" && warming() && isLoading() && error() === null && rows().length === 0;

  // Some feature suites mock the snapshot module with only the hook; keep their
  // feed-mode badge intact when the liveness helper is absent there.
  const universeIsLive = () =>
    typeof isLiveUniverse === "function" ? isLiveUniverse(universe()) : true;

  const modeBadge = createMemo(() => {
    if (!universeIsLive()) {
      return {
        label: "Closed",
        color: "default" as const,
        hint: "Market closed · showing last snapshot",
      };
    }
    const mode = (updateMode() ?? "").toLowerCase();
    if (mode === "streaming") {
      return { label: "Live", color: "success" as const, hint: "Live streaming feed" };
    }
    if (!updateMode()) {
      return { label: "Unknown", color: "default" as const, hint: "Feed mode not reported" };
    }
    return { label: "Delayed", color: "warning" as const, hint: `Feed mode: ${updateMode()}` };
  });

  const waitingForConfig = () => !configReady() && viewMode() !== "value";
  const showInitialLoading = () => (waitingForConfig() || isLoading()) && rows().length === 0;
  const showError = () => error() !== null && rows().length === 0;
  const showErrorBanner = () => error() !== null && !isLoading() && rows().length > 0;

  const handleRowClick = (row: MarketRow) => selectAndOpen(row.symbol);

  const navigationRows = createMemo(() => {
    const sorted = sortedRows();
    return sorted.length > 0 ? sorted : filteredRows();
  });

  const rowIndex = createMemo(() => {
    const symbol = selectedSymbol();
    return symbol ? navigationRows().findIndex((row) => row.symbol === symbol) : -1;
  });

  const stepSymbol = (direction: 1 | -1) => {
    const rows = navigationRows();
    if (!rows.length) return;
    const current = rowIndex();
    // No selection yet: Down starts at the top, Up at the bottom.
    const base = current < 0 ? (direction > 0 ? -1 : rows.length) : current;
    const next = rows[Math.min(Math.max(base + direction, 0), rows.length - 1)];
    if (next.symbol === selectedSymbol()) return;
    selectAndOpen(next.symbol);
    document
      .querySelector(`[data-testid="market-row-${next.symbol}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  // Arrow keys walk the filtered list and re-point the chart at the new symbol.
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      // A modal drawer owns the keyboard; arrow keys inside it are not row steps.
      if (drawerOpen()) return;
      // The Value view and the Sections tab own their own tables.
      if (viewMode() === "value" || sectionsActive()) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      stepSymbol(event.key === "ArrowDown" ? 1 : -1);
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  const chooseView = (mode: ScreenerTab) => {
    // A modal drawer would otherwise float above the value/sections panel.
    if (mode === "value" || mode === "sections") closeDrawer();
    // Sections is not persisted: leaving it restores the previous market view.
    if (mode === "sections") {
      setSectionsActive(true);
      return;
    }
    setSectionsActive(false);
    setViewMode(mode);
    // The market search is hidden in Movers; keeping a live filter there
    // would silently shrink the table when the user comes back. Value leaves
    // it alone so the table returns exactly as the user left it.
    if (mode === "movers") setSearch("");
    props.onViewChange?.(mode);
  };

  const getRowStyle = (row: MarketRow): JSX.CSSProperties | undefined =>
    row.symbol === selectedSymbol()
      ? { "background-color": alpha(PRIMARY, 0.16) }
      : undefined;

  const getRowTestId = (row: MarketRow) => `market-row-${row.symbol}`;

  return (
    <Box
      data-testid="market-screener"
      className="flex-1 h-full min-w-0 min-h-0 flex flex-col gap-2 overflow-hidden"
    >
      <Paper
        elevation={0}
        data-testid="market-toolbar"
        className="flex items-center gap-2 px-2 py-2 border border-fin-border rounded-sm bg-fin-surface flex-shrink-0 overflow-hidden"
      >
        <Select
          value={universe()}
          onChange={(v) => v && setUniverse(v as MarketUniverse)}
          data={UNIVERSE_OPTIONS}
          size="xs"
          h={28}
          w={120}
          aria-label="Market universe"
          data-testid="market-universe-select"
        />
        <Show when={showMarketChrome()}>
          <TextInput
            placeholder="Search symbol or name…"
            size="xs"
            h={28}
            w={210}
            value={search()}
            onChange={(value: string) => setSearch(value)}
            leftSection={<IconSearch size={12} />}
            aria-label="Search symbols"
            data-testid="market-search"
          />
        </Show>
        {/* The toolbar sits directly under the tab strip: a default "top"
            tooltip renders above the viewport and is clipped. */}
        <Show when={viewMode() !== "value" && !sectionsActive()}>
          <Tooltip label={modeBadge().hint} position="bottom">
            <Badge
              size="xs"
              variant="light"
              color={modeBadge().color}
              data-testid="market-mode-badge"
            >
              {modeBadge().label}
            </Badge>
          </Tooltip>
        </Show>
        <Show when={stale() && viewMode() !== "value" && !sectionsActive()}>
          <Tooltip
            position="bottom"
            multiline
            label={staleHint()}
          >
            <Badge size="xs" variant="outline" color="warning" data-testid="market-stale-badge">
              Stale
            </Badge>
          </Tooltip>
        </Show>
        <Box className="flex-1 min-w-0" />
        <Show when={showMarketChrome()}>
          <Text
            size="xs"
            c="dimmed"
            truncate
            title={`${formatNumberIN(matchCount())} of ${formatNumberIN(rows().length)} loaded rows match (universe total ${formatNumberIN(total())})`}
            data-testid="market-result-count"
            className="font-numeric whitespace-nowrap"
          >
            {formatNumberIN(matchCount())} / {formatNumberIN(rows().length)}
          </Text>
        </Show>
        <Show when={viewMode() !== "value" && !sectionsActive()}>
          <Tooltip label="Refresh snapshot — fresh scan" position="bottom">
            <span>
              <ActionIcon
                variant="subtle"
                size={28}
                onClick={() => refresh(true)}
                disabled={isLoading() || waitingForConfig()}
                aria-label="Refresh snapshot (fresh scan)"
                data-testid="market-refresh"
              >
                <Show when={isLoading()} fallback={<IconRefresh size={14} />}>
                  <Loader size={12} />
                </Show>
              </ActionIcon>
            </span>
          </Tooltip>
        </Show>
        <Show when={showMarketChrome()}>
          <Show when={savedConfigError() !== null}>
            <Box
              role="status"
              data-testid="saved-config-error"
              className="flex items-center gap-1 flex-shrink-0"
            >
              <Text size="xs" c="warning" className="whitespace-nowrap">
                {savedConfigError() === "conflict"
                  ? "Filters changed in another tab"
                  : "Filters not saved"}
              </Text>
              <Show when={savedConfigFailed()}>
                <Button
                  size="xs"
                  variant="subtle"
                  style={{ height: "24px" }}
                  onClick={() => savedConfig.retry()}
                  data-testid="saved-config-retry"
                >
                  Retry
                </Button>
              </Show>
            </Box>
          </Show>
          <Indicator
            label={String(activeCount())}
            color="primary"
            size={14}
            disabled={activeCount() === 0}
            data-testid="market-filter-count"
          >
            <Tooltip
              position="bottom"
              label={isNarrow() ? "Open filters" : railCollapsed() ? "Show filters" : "Hide filters"}
            >
              <ActionIcon
                variant="subtle"
                size={28}
                onClick={handleToggleRail}
                aria-label={isNarrow() ? "Open filters" : "Toggle filters"}
                aria-pressed={isNarrow() ? drawerOpen() : !railCollapsed()}
                aria-expanded={isNarrow() ? drawerOpen() : !railCollapsed()}
                data-testid="market-rail-toggle"
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Tooltip>
          </Indicator>
        </Show>
        <SegmentedControl
          value={activeTab()}
          onChange={(value) => chooseView(value as ScreenerTab)}
          data={SECTION_TABS}
          size="xs"
          data-testid="market-view-toggle"
          scrollable
          scrollLabel="Scroll tabs"
          scrollTestId="market-view-scroll"
        />
        <Show when={showMarketChrome()}>
          <Button
            size="xs"
            variant="subtle"
            style={{ height: "28px" }}
            leftSection={<IconX size={12} />}
            onClick={resetFilters}
            data-testid="market-reset"
          >
            Reset
          </Button>
        </Show>
      </Paper>

      {/* The snapshot hook is the only source for this strip: no extra fetch,
          and the full rows (not the filtered table) define market breadth.
          US rows carry no index component, so the India strip is replaced by a
          same-box placeholder: unmounting the band moved the table 44px on a
          universe switch (36px strip + the flex gap) and broke the E2E's stable
          filter-row geometry. The placeholder mirrors the strip's Paper box and
          two-line stat so its height tracks any typography change. */}
      <Show
        when={showMarketChrome() && universe() !== "us"}
        fallback={
          <Show when={showMarketChrome()}>
            <Paper
              elevation={0}
              data-testid="market-breadth-unavailable"
              role="note"
              className="flex items-center gap-2 px-2 py-1 border border-fin-border rounded-sm bg-fin-surface flex-shrink-0 min-w-0 overflow-hidden"
            >
              <Box className="flex flex-col flex-shrink-0 gap-0.5">
                <Text size="xs" c="dimmed" className="leading-none">
                  Breadth
                </Text>
                <Text size="xs" c="dimmed" className="font-mono tabular-nums leading-none">
                  — not available for USA
                </Text>
              </Box>
            </Paper>
          </Show>
        }
      >
        <MarketBreadthStrip
          rows={rows()}
          asOf={asOf()}
          isLoading={isLoading() || waitingForConfig()}
        />
      </Show>

      <Show when={showWarmingHint() && viewMode() !== "value" && !sectionsActive()}>
        <Box
          role="status"
          data-testid="market-warming-hint"
          className="flex items-center gap-1 px-2 py-0.5 flex-shrink-0 border border-fin-border rounded-sm bg-fin-surface"
        >
          <Loader size={12} />
          <Text size="xs" c="dimmed" data-testid="market-warming-hint-text">
            Still warming All NSE — switch to Nifty 500 for instant data
          </Text>
          <Box className="flex-1 min-w-0" />
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setUniverse("nifty500")}
            data-testid="market-warming-switch"
          >
            Switch to Nifty 500
          </Button>
        </Box>
      </Show>

      <Show when={showErrorBanner() && viewMode() !== "value" && !sectionsActive()}>
        <Box
          role="alert"
          data-testid="market-error-banner"
          className="flex items-center gap-1 px-2 py-0.5 flex-shrink-0 border border-fin-border border-l-[3px] border-l-fin-negative rounded-sm bg-fin-surface"
        >
          <IconAlertCircle size={14} />
          <Text size="xs" c="error" className="flex-1 min-w-0" data-testid="market-error-banner-message">
            Refresh failed: {error()?.message}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRefresh size={12} />}
            onClick={() => refresh()}
            data-testid="market-error-banner-retry"
          >
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={viewMode() !== "value" && !sectionsActive()}>
        <FilterStatusRow
          testId="market-active-chips"
          hasFilters={chips().length > 0 || (props.symbolAllowlist?.length ?? 0) > 0}
          className="flex-shrink-0"
        >
          <For each={chips()}>{(chip) => (
            <Box
              component="button"
              type="button"
              onClick={() => removeChip(chip.key)}
              aria-label={`Remove filter ${chip.label}`}
              data-testid={`market-filter-chip-${chip.key}`}
              className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[11px] border border-fin-border bg-fin-surface text-fin-text text-ui-micro leading-none cursor-pointer hover:border-fin-primary hover:text-fin-primary"
            >
              <Text size="xs" className="leading-none">
                {chip.label}
              </Text>
              <IconX size={12} />
            </Box>
          )}</For>
          <Show when={props.symbolAllowlist && props.symbolAllowlist.length > 0}>
            <Box
              component="button"
              type="button"
              onClick={() => props.onClearSymbolAllowlist?.()}
              aria-label="Clear symbol allowlist"
              data-testid="market-symbol-allowlist"
              className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[11px] border border-fin-border bg-fin-surface text-fin-text text-ui-micro leading-none cursor-pointer hover:border-fin-primary hover:text-fin-primary"
            >
              <Text size="xs" className="leading-none">
                Movers · {props.symbolAllowlist!.length} symbols ×
              </Text>
              <IconX size={12} />
            </Box>
          </Show>
        </FilterStatusRow>
      </Show>

      <Box className="flex-1 min-h-0 flex gap-2 overflow-hidden">
        <Show when={!isNarrow() && !railCollapsed() && showMarketChrome()}>
          <Box
            data-testid="market-rail-panel"
            className="w-[240px] flex-shrink-0 min-h-0 overflow-y-auto border border-fin-border rounded-sm bg-fin-surface"
          >
            <MarketFilterRail
              filters={filters()}
              onChange={applyPreset}
              sectors={sectors()}
              tierCounts={tierCounts()}
              currency={currency()}
              onCollapse={isNarrow() ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
              collapseLabel={isNarrow() ? "Close filters" : "Collapse filters"}
            />
          </Box>
        </Show>

        <Box className="flex-1 min-w-0 min-h-0 flex flex-col">
          {sectionsActive() ? (
            <SectionsView
              market={universe() === "us" ? "america" : "india"}
              onOpenSymbol={selectAndOpen}
            />
          ) : viewMode() === "value" ? (
            <Box
              data-testid="market-value-region"
              className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden"
            >
              <Suspense
                fallback={
                  <Box
                    data-testid="market-value-loading"
                    className="flex items-center justify-center gap-2 py-6 border border-fin-border rounded-sm bg-fin-surface"
                  >
                    <Loader size={14} />
                    <Text size="xs" c="dimmed">
                      Loading value scan…
                    </Text>
                  </Box>
                }
              >
                <ValueView
                  embedded
                  market={marketUniverseToValueMarket(universe()) ?? "india"}
                  onOpenSymbol={selectAndOpen}
                  onApplyMarketPreset={applyPreset}
                />
              </Suspense>
            </Box>
          ) : viewMode() === "movers" ? (
            <Box className="flex-1 min-w-0 min-h-0 overflow-y-auto">
              <MoversPanel
                universe={universe()}
                selectedSymbol={selectedSymbol()}
                onOpenSymbol={selectAndOpen}
                onOpenScan={props.onOpenScan}
              />
            </Box>
          ) : (
            <Show
              when={showInitialLoading()}
              fallback={
                <Show
                  when={!showError()}
                  fallback={
                    <Paper
                      elevation={0}
                      role="alert"
                      data-testid="market-error"
                      className="flex-1 border border-fin-border rounded-sm bg-fin-surface flex flex-col items-center justify-center gap-2 p-6 text-center"
                    >
                      <IconAlertCircle size={24} />
                      <Text size="sm" fw={600}>
                        Couldn’t load the market snapshot
                      </Text>
                      <Text size="xs" c="dimmed" data-testid="market-error-message">
                        {error()?.message}
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        leftSection={<IconRefresh size={12} />}
                        onClick={() => refresh()}
                        data-testid="market-retry"
                      >
                        Retry
                      </Button>
                    </Paper>
                  }
                >
                  {/* The table stays mounted across view switches. Unmounting it
                      reset TanStack's internal sorting state, so Table → Map →
                      Table silently lost the user's sort. */}
                  <Box
                    // One busy flag for the whole table: the PATTERNS lookup is
                    // supplementary, so it must never mount a per-row spinner.
                    aria-busy={patterns.loading() ? "true" : undefined}
                    data-patterns-loading={patterns.loading() ? "true" : undefined}
                    data-testid="market-table-region"
                    className={
                      viewMode() === "vis"
                        ? "hidden"
                        : "flex-1 min-w-0 min-h-0 flex flex-col"
                    }
                  >
                    <MarketGrid
                      data={filteredRows()}
                      columns={columns()}
                      narrow={narrow()}
                      hasActiveFilters={hasActiveFilters()}
                      onResetFilters={resetFilters}
                      onRowClick={handleRowClick}
                      getRowStyle={getRowStyle}
                      getRowTestId={getRowTestId}
                      onVisibleRowsChange={setVisibleRows}
                      onSortedRowsChange={setSortedRows}
                      presetOwnsOrder={presetOwnsOrder()}
                    />
                  </Box>
                  <Show when={viewMode() === "vis"}>
                    <ToolbarRow
                      gap={8}
                      wrap
                      // The band can wrap on narrow screens; h-auto/min-h-9 let
                      // the row grow with its content instead of painting a
                      // second line over the visualization below it.
                      className="px-2 h-auto min-h-9 py-1 flex-shrink-0 border-b border-fin-border"
                      data-testid="market-vis-toolbar"
                    >
                      <Show when={!visToolbarCompact()}>
                        <Text size="xs" c="dimmed" className="whitespace-nowrap">
                          Visualization
                        </Text>
                      </Show>
                      {/* Ten modes cannot fit at 390px. The primitive's track is
                          w-full against an inline-flex parent, so without the
                          cap here it resolves to the sum of its min-w-max items
                          (~780px) and the select steals the pointer. The child
                          rule pins that wrapper to this cell's width, making
                          the track a real scrollport with its scroll cue.
                          At sm the base must be 0: an auto base resolves to the
                          inline width:100% and flex-wrap sends the Size by band
                          to a second line even though flex-1 could shrink. */}
                      <Box
                        data-testid="market-vis-selector-cell"
                        className="min-w-0 flex-1 basis-full sm:basis-0 [&>div]:w-full [&>div]:max-w-full"
                        style={{ width: "100%", "max-width": "100%" }}
                      >
                        <SegmentedControl
                          value={visMode()}
                          onChange={(value) => setVisMode(value as VisMode)}
                          data={VIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                          size="xs"
                          scrollable
                          scrollLabel="Scroll visualizations"
                          scrollTestId="market-vis-scroll"
                          data-testid="market-vis-selector"
                        />
                      </Box>
                      {/* Only the treemaps size tiles by a numeric metric. The
                          selector stays mounted; this one control does not.
                          `basis-full sm:basis-auto` moves the whole band to its
                          own line below sm instead of letting the 128px select
                          overlap a selector option. Above sm the band keeps its
                          auto width so it shares the selector's row. */}
                      <Show when={SIZE_BY_VIS_MODES.has(visMode())}>
                        <Box
                          data-testid="market-vis-size-band"
                          className="flex flex-shrink-0 items-center gap-2 basis-full sm:basis-auto sm:w-auto"
                        >
                          <Text size="xs" c="dimmed" className="whitespace-nowrap">
                            Size by
                          </Text>
                          <Select
                            size="xs"
                            w={128}
                            className="min-w-[128px]"
                            value={sizeBy()}
                            onChange={(value: string | null) => {
                              if (isMarketSizeMetric(value)) setSizeBy(value);
                            }}
                            data={marketMetricOptions(currency())}
                            aria-label="Size the map by"
                            data-testid="market-map-metric"
                          />
                        </Box>
                      </Show>
                    </ToolbarRow>
                    {/* Render the registry entry as a real component, not an inline
                        function call. `filteredRows()` is a tracked dependency of
                        this JSX slot; calling the renderer directly re-invoked it on
                        every poll, recreating the viz's signals — fullscreen
                        `expanded` reset to false and the modal closed itself.
                        `Dynamic` re-instantiates only when visMode changes. */}
                    <Dynamic
                      component={VIS_RENDERERS[visMode()]}
                      rows={filteredRows()}
                      allRows={rows()}
                      onSymbolClick={selectAndOpen}
                      currency={currency()}
                      sizeBy={sizeBy()}
                      onSizeByChange={setSizeBy}
                      showSizeControl={false}
                    />
                  </Show>
                </Show>
              }
            >
              <Paper
                elevation={0}
                data-testid="market-skeleton"
                className="flex-1 border border-fin-border rounded-sm bg-fin-surface p-2 flex flex-col gap-2"
              >
                <For each={Array.from({ length: 12 }, (_, i) => i)}>{() => <Skeleton h={24} visible />}</For>
              </Paper>
            </Show>
          )}
        </Box>
        <Show when={isWide() && viewMode() !== "value" && !sectionsActive()}>
          <ChartDockOutlet class="flex-shrink-0 basis-[38%] min-w-80 max-w-3xl min-h-0 flex flex-col overflow-hidden" />
        </Show>
      </Box>

      <Show when={isNarrow() && drawerOpen()}>
        <Box
          ref={(el: HTMLDivElement) => (drawerEl = el)}
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          tabIndex={-1}
          data-testid="market-filter-drawer"
          className="fixed inset-0 z-[1300] flex"
          // The mobile nav bar is sticky at z-1299; a lower drawer leaves its
          // header (and the collapse button) unclickable at 390px.
          style={{ "z-index": 1300 }}
          onClick={closeDrawer}
        >
          <Box
            className="absolute inset-y-0 left-0 w-72 max-w-[280px] bg-fin-surface border-r border-fin-border flex flex-col transform transition-transform duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <MarketFilterRail
              filters={filters()}
              onChange={applyPreset}
              sectors={sectors()}
              tierCounts={tierCounts()}
              currency={currency()}
              onCollapse={closeDrawer}
              collapseLabel="Close filters"
              portalGallery
            />
          </Box>
        </Box>
      </Show>
    </Box>
  );
}
