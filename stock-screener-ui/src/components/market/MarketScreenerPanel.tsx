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
import { IconAlertCircle, IconFilter, IconRefresh, IconSearch, IconX } from "../common/Icons";
import { formatNumberIN } from "@/utils/ui-helpers";
import { MARKET_UNIVERSES, DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import type { SortEntry, TableColumnDef as ColumnDef } from "../common/TanStackTable";
import type { MarketRow, MarketUniverse } from "../../types/marketScreener";
import { marketUniverseDescriptor } from "../../config/marketUniverses";
import {
  buildMarketFilterChips,
  countActiveMarketFilters,
  defaultMarketFilters,
  filterOnlyMarketRows,
  marketSectors,
  countByCapTier,
  resetUniverseSpecificFilters,
  sortMarketRows,
  universeHasFno,
  type MarketFilterState,
  type MarketSortKey,
} from "./marketFilters";
import { buildMarketColumns } from "./marketColumns";
import { usePatternSummary } from "./usePatternSummary";
import { alpha, PRIMARY } from "@/ui/palette";
import { MarketFilterRail } from "./MarketFilterRail";
import {
  MarketViewToggle,
  VIS_OPTIONS,
  VIS_RENDERERS,
  normalizeMarketView,
  type MarketViewMode,
  type VisMode,
} from "./MarketMapView";
import {
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
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { useSymbolDock } from "../common/symbolDockContext";
import { useMarketConfig, type MarketConfigValue } from "./useMarketConfig";

// Movers owns the whole dashboard module; keep it out of the Market chunk.
const DashboardView = lazy(() =>
  import("../screener/DashboardView").then((m) => ({ default: m.DashboardView })),
);
// Value owns its own scan pipeline; load it only when the Value view is opened.
const ValueView = lazy(() =>
  import("../value/ValuePanel").then((m) => ({ default: m.ValuePanel })),
);

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
function MarketGrid(props: {
  data: MarketRow[];
  columns: ColumnDef<MarketRow>[];
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onRowClick: (row: MarketRow) => void;
  getRowStyle: (row: MarketRow) => JSX.CSSProperties | undefined;
  getRowTestId: (row: MarketRow) => string;
  onVisibleRowsChange?: (rows: MarketRow[]) => void;
  onSortedRowsChange?: (rows: MarketRow[]) => void;
}) {
  const { prefs, setSorting, setColumnPrefs } = useTablePrefs("market.grid");
  // Empty saved prefs keep the historical first-load order; the store writes
  // only after a real sort change, so the default is never persisted on mount.
  const sorting = (): SortEntry[] =>
    prefs().sorting.length > 0 ? prefs().sorting : DEFAULT_TABLE_SORTING;
  return (
    <TanStackTable
      data={props.data}
      columns={props.columns}
      dataTestId="market-grid"
      ariaLabel="Market screener results"
      rowWindowSize={80}
      fillContainer
      dense
      minTableWidth={1000}
      enableSorting
      stickyHeader
      tableId="market.grid"
      enableColumnControls
      columnPrefs={{ order: prefs().order, hidden: prefs().hidden }}
      onColumnPrefsChange={({ order, hidden }) => setColumnPrefs({ order, hidden })}
      // SYMBOL identifies the row; hiding it would leave an anonymous row.
      lockVisible={["symbol"]}
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
  // The Vis tab renders through the registry. The selector writes this signal;
  // it is intentionally local state — a viz choice is not a saved config, and
  // must never echo back through save()/scheduleSave().
  const [visMode, setVisMode] = createSignal<VisMode>(VIS_OPTIONS[0]!.value);
  const [sizeBy, setSizeBy] = createSignal<MarketSizeMetric>(DEFAULT_MARKET_SIZE_METRIC);
  // Value is a view, not a separate page: every Market filter lives in this
  // component's signals, so switching back restores the table as it was.
  const showMarketChrome = () => viewMode() !== "movers" && viewMode() !== "value";
  const [selectedSymbol, setSelectedSymbol] = createSignal<string | null>(null);
  const dock = useSymbolDock();
  const navigate = useNavigate();
  // Shares the same ref-counted store instance as MarketGrid. The table's
  // TanStack sort is the single source of truth; the map/snapshot enum is derived
  // from it below (one-way) instead of being bridged in both directions.
  const { prefs: tablePrefs } = useTablePrefs("market.grid");

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
      // single sizing metric, not a colour choice.
      setSizeBy(value.colorBy ?? DEFAULT_MARKET_SIZE_METRIC);
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
  // The Vis toolbar shares the treemap's narrow threshold: below it the helper
  // label is dropped and controls wrap into their own rows instead of colliding.
  const visToolbarCompact = useMediaQuery(`(max-width: ${NARROW_TREEMAP_MAX_WIDTH - 1}px)`);

  const { rows, total, updateMode, asOf, isLoading, error, refresh, stale: cachedStale, ageSec, warming } =
    useMarketSnapshotSolid(universe, {
      // Wait for `market.filters` so the first snapshot is the saved universe,
      // not defaults followed by a second fetch when hydration lands.
      enabled: () => viewMode() !== "value" && configReady(),
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

  const columns = createMemo(() => {
    const f = filters();
    return buildMarketColumns({
      onSymbolOpen: selectAndOpen,
      onChartOpen: openChart,
      // A pinned sector makes the column constant; it carries no information.
      hideSector: f.sectors.length > 0,
      // Read through the signal: cells re-render when the lookup lands without
      // rebuilding the column list (a rebuild would remount every row).
      patternsFor: (symbol) => patterns.summary().get(symbol),
      // Drives the MCAP header's unit; cells still read each row's own currency.
      universe: universe(),
    });
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
    setFilters((f) => {
      if (key.startsWith("capTier:")) {
        const tier = key.slice("capTier:".length);
        const next = new Set(f.capTiers);
        next.delete(tier);
        return { ...f, capTiers: next };
      }
      switch (key) {
        case "price":
          return { ...f, priceMin: null, priceMax: null };
        case "day":
          return { ...f, dayChangeMin: null, dayChangeMax: null };
        case "mcap":
          return { ...f, mcapMinCr: null, mcapMaxCr: null };
        case "rsi":
          return { ...f, rsiMin: null, rsiMax: null };
        case "relvol":
          return { ...f, relVolMin: null, relVolMax: null };
        case "sma20":
          return { ...f, aboveSma20: false };
        case "sma50":
          return { ...f, aboveSma50: false };
        case "sma200":
          return { ...f, aboveSma200: false };
        case "fno":
          return { ...f, fnoOnly: false };
        case "sector":
          return { ...f, sectors: [] };
        default:
          if (key.startsWith("sector:")) {
            const name = key.slice("sector:".length);
            return { ...f, sectors: f.sectors.filter((s) => s !== name) };
          }
          return f;
      }
    });
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
    if (viewMode() === "value" && drawerOpen()) closeDrawer();
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
      if (event.key === "Escape") {
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

  const modeBadge = createMemo(() => {
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
      // The Value view owns its own table; don't step market rows behind it.
      if (viewMode() === "value") return;
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

  const chooseView = (mode: MarketViewMode) => {
    // A modal drawer would otherwise float above the value table.
    if (mode === "value") closeDrawer();
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
          searchable
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
        <Show when={viewMode() !== "value"}>
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
        <Show when={stale() && viewMode() !== "value"}>
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
        <Show when={viewMode() !== "value"}>
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
        <MarketViewToggle value={viewMode()} onChange={chooseView} />
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

      <Show when={showWarmingHint() && viewMode() !== "value"}>
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

      <Show when={showErrorBanner() && viewMode() !== "value"}>
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

      <Show when={viewMode() !== "value"}>
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
              className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[11px] border border-fin-border bg-fin-surface text-fin-text text-[11px] leading-none cursor-pointer hover:border-fin-primary hover:text-fin-primary"
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
              className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded-[11px] border border-fin-border bg-fin-surface text-fin-text text-[11px] leading-none cursor-pointer hover:border-fin-primary hover:text-fin-primary"
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
              onChange={patchFilters}
              sectors={sectors()}
              tierCounts={tierCounts()}
              currency={currency()}
              onCollapse={isNarrow() ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
              collapseLabel={isNarrow() ? "Close filters" : "Collapse filters"}
            />
          </Box>
        </Show>

        <Box className="flex-1 min-w-0 min-h-0 flex flex-col">
          {viewMode() === "value" ? (
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
                      hasActiveFilters={hasActiveFilters()}
                      onResetFilters={resetFilters}
                      onRowClick={handleRowClick}
                      getRowStyle={getRowStyle}
                      getRowTestId={getRowTestId}
                      onVisibleRowsChange={setVisibleRows}
                      onSortedRowsChange={setSortedRows}
                    />
                  </Box>
                  <Show when={viewMode() === "vis"}>
                    <ToolbarRow
                      gap={8}
                      wrap
                      className={
                        visToolbarCompact()
                          ? "px-2 py-1 flex-shrink-0 border-b border-fin-border"
                          : "px-2 h-9 flex-shrink-0 border-b border-fin-border"
                      }
                      data-testid="market-vis-toolbar"
                    >
                      <Show when={!visToolbarCompact()}>
                        <Text size="xs" c="dimmed" className="whitespace-nowrap">
                          Visualization
                        </Text>
                      </Show>
                      <SegmentedControl
                        value={visMode()}
                        onChange={(value) => setVisMode(value as VisMode)}
                        data={VIS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        size="xs"
                        data-testid="market-vis-selector"
                      />
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
                    </ToolbarRow>
                    {VIS_RENDERERS[visMode()]({
                      rows: filteredRows(),
                      onSymbolClick: selectAndOpen,
                      currency: currency(),
                      sizeBy: sizeBy(),
                      onSizeByChange: setSizeBy,
                      showSizeControl: false,
                    })}
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
        <Show when={isWide() && viewMode() !== "value"}>
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
          className="fixed inset-0 z-50 flex"
          style={{ "z-index": 1050 }}
          onClick={closeDrawer}
        >
          <Box
            className="absolute inset-y-0 left-0 w-72 max-w-[280px] bg-fin-surface border-r border-fin-border flex flex-col transform transition-transform duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <MarketFilterRail
              filters={filters()}
              onChange={patchFilters}
              sectors={sectors()}
              tierCounts={tierCounts()}
              currency={currency()}
              onCollapse={closeDrawer}
              collapseLabel="Close filters"
            />
          </Box>
        </Box>
      </Show>
    </Box>
  );
}
