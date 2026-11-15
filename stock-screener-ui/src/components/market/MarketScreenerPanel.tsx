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
  type JSX,
} from "solid-js";
import {
  Box,
  Button,
  Badge,
  Paper,
  Select,
  Skeleton,
  Text,
  TextInput,
  Tooltip,
  ActionIcon,
  Loader,
  Indicator,
  useMediaQuery,
} from "@/ui";
import { IconAlertCircle, IconFilter, IconRefresh, IconSearch, IconX } from "../common/Icons";
import { formatNumberIN } from "@/utils/ui-helpers";
import { MARKET_UNIVERSES, DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import type { TableColumnDef as ColumnDef } from "../common/TanStackTable";
import type { MarketRow, MarketUniverse } from "../../types/marketScreener";
import {
  buildMarketFilterChips,
  countActiveMarketFilters,
  defaultMarketFilters,
  filterOnlyMarketRows,
  marketSectors,
  countByCapTier,
  sortMarketRows,
  type MarketFilterState,
} from "./marketFilters";
import { buildMarketColumns } from "./marketColumns";
import { usePatternSummary } from "./usePatternSummary";
import { alpha, PRIMARY } from "@/ui/palette";
import { MarketFilterRail } from "./MarketFilterRail";
import { MarketMapView, MarketViewToggle, type MarketViewMode } from "./MarketMapView";
import { TanStackTable } from "../common/TanStackTable";
import { ChartDockOutlet } from "../common/ChartDockOutlet";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { useSymbolDock } from "../common/symbolDockContext";
import { useMarketConfig, type MarketConfigValue } from "./useMarketConfig";

// Movers owns the whole dashboard module; keep it out of the Market chunk.
const DashboardView = lazy(() =>
  import("../screener/DashboardView").then((m) => ({ default: m.DashboardView })),
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
const UNIVERSE_OPTIONS = MARKET_UNIVERSES.map((o) => ({ value: o.value, label: o.label }));

function isSnapshotStale(asOf: string | null): boolean {
  if (!asOf) return false;
  const parsed = Date.parse(asOf);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed > STALE_AFTER_MS;
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
}) {
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
      initialState={{ sorting: [{ id: "market_cap_cr", desc: true }] }}
      onRowClick={props.onRowClick}
      getRowStyle={props.getRowStyle}
      getRowTestId={props.getRowTestId}
      onVisibleRowsChange={props.onVisibleRowsChange}
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
}

export function MarketScreenerPanel(props: MarketScreenerPanelProps = {}) {
  const [universe, setUniverse] = createSignal<MarketUniverse>(DEFAULT_MARKET_UNIVERSE);
  const [search, setSearch] = createSignal("");
  const [filters, setFilters] = createSignal<MarketFilterState>(defaultMarketFilters());
  const [railCollapsed, setRailCollapsed] = createSignal(false);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<MarketViewMode>(props.initialView ?? "table");
  const [selectedSymbol, setSelectedSymbol] = createSignal<string | null>(null);
  const dock = useSymbolDock();

  // Saved config: `?view=` wins when present, saved state is the fallback for a
  // bare `/screener`, defaults otherwise. Hydration is applied in one batch and
  // `prevUniverse` is moved first — see the reset effect below.
  let prevUniverse = universe();
  const applySavedConfig = (value: MarketConfigValue) => {
    batch(() => {
      // Announce the hydrated universe to the reset effect before the signal
      // moves: restoring nifty500 must not wipe the sectors restored with it.
      prevUniverse = value.universe;
      setUniverse(value.universe);
      setFilters(value.filters);
      setViewMode(value.view);
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
  // The symbol cell opens the dock directly (it stops row-click propagation),
  // so the list must follow the dock or the chart's row never highlights and
  // the arrow-key handler has no anchor.
  createEffect(() => {
    const shown = dock.symbol?.();
    if (shown && shown !== selectedSymbol()) setSelectedSymbol(shown);
  });

  /** One path for every affordance: row, symbol text, chart icon, map tile,
   *  keyboard. Selection and the dock can never disagree. */
  const selectAndOpen = (symbol: string) => {
    setSelectedSymbol(symbol);
    dock.open(symbol);
  };
  const isNarrow = useMediaQuery("(max-width: 1023px)");
  const isWide = useMediaQuery("(min-width: 1400px)");

  const { rows, total, updateMode, asOf, isLoading, error, refresh, stale: cachedStale, warming } =
    useMarketSnapshotSolid(universe);

  // Filters belong to one universe's snapshot; carrying them across a universe
  // switch silently hides every row of the new universe.
  createEffect(() => {
    const u = universe();
    // Hydration advances `prevUniverse` to the restored universe inside the same
    // batch, so this comparison is already false for the restore write: the
    // saved sectors survive. Firing here would reset them.
    if (u !== prevUniverse) {
      prevUniverse = u;
      setFilters(defaultMarketFilters());
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
  const filteredRows = createMemo(() =>
    sortMarketRows(
      filterOnlyMarketRows(rows(), { ...filters(), search: search() }).filter(
        (row) => allowlisted() == null || allowlisted()!.has(row.symbol),
      ),
      filters().sort,
    ),
  );
  // The sorted set has the same membership as the filtered one, so reuse it
  // instead of walking all ~3,200 rows a second time per filter change.
  const matchCount = createMemo(() => filteredRows().length);
  const chips = createMemo(
    () => buildMarketFilterChips({ ...filters(), search: search() }),
  );
  const activeCount = createMemo(
    () => countActiveMarketFilters({ ...filters(), search: search() }),
  );
  const sectors = createMemo(() => marketSectors(rows()));
  const tierCounts = createMemo(() => countByCapTier(rows()));

  // The PATTERNS column is fed from the window the table actually mounts:
  // ~80 rows, one batch lookup, never the ~3,200-row snapshot.
  const [visibleRows, setVisibleRows] = createSignal<MarketRow[]>([]);
  const patterns = usePatternSummary(
    () => visibleRows().map((row) => row.symbol),
    () => universe(),
  );

  const columns = createMemo(() => {
    const f = filters();
    return buildMarketColumns({
      onSymbolOpen: selectAndOpen,
      // A pinned sector makes the column constant; it carries no information.
      hideSector: f.sectors.length > 0,
      // Read through the signal: cells re-render when the lookup lands without
      // rebuilding the column list (a rebuild would remount every row).
      patternsFor: (symbol) => patterns.summary().get(symbol),
    });
  });
  const stale = createMemo(() => cachedStale() || isSnapshotStale(asOf()));
  const hasActiveFilters = () => chips().length > 0;

  const patchFilters = (patch: Partial<MarketFilterState>) =>
    setFilters((f) => ({ ...f, ...patch }));

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
        case "etf":
          return { ...f, etfOnly: false };
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

  const handleToggleRail = () => {
    if (isNarrow()) {
      setDrawerOpen((open) => !open);
    } else {
      setRailCollapsed((collapsed) => !collapsed);
    }
  };

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

  const showInitialLoading = () => isLoading() && rows().length === 0;
  const showError = () => error() !== null && rows().length === 0;
  const showErrorBanner = () => error() !== null && !isLoading() && rows().length > 0;

  const handleRowClick = (row: MarketRow) => selectAndOpen(row.symbol);

  const rowIndex = createMemo(() => {
    const symbol = selectedSymbol();
    return symbol ? filteredRows().findIndex((row) => row.symbol === symbol) : -1;
  });

  const stepSymbol = (direction: 1 | -1) => {
    const rows = filteredRows();
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
        <Show when={viewMode() !== "movers"}>
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
        <Show when={stale()}>
          <Tooltip
            position="bottom"
            multiline
            label={
              cachedStale() && isLoading()
                ? "Showing the last snapshot — refreshing in the background"
                : `Snapshot is older than 15 minutes (as of ${asOf() ?? "unknown"})`
            }
          >
            <Badge size="xs" variant="outline" color="warning" data-testid="market-stale-badge">
              Stale
            </Badge>
          </Tooltip>
        </Show>
        <Box className="flex-1 min-w-0" />
        <Show when={viewMode() !== "movers"}>
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
        <Tooltip label="Refresh snapshot" position="bottom">
          <span>
            <ActionIcon
              variant="subtle"
              size={28}
              onClick={refresh}
              disabled={isLoading()}
              aria-label="Refresh snapshot"
              data-testid="market-refresh"
            >
              <Show when={isLoading()} fallback={<IconRefresh size={14} />}>
                <Loader size={12} />
              </Show>
            </ActionIcon>
          </span>
        </Tooltip>
        <Show when={viewMode() !== "movers"}>
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
                data-testid="market-rail-toggle"
              >
                <IconFilter size={14} />
              </ActionIcon>
            </Tooltip>
          </Indicator>
        </Show>
        <MarketViewToggle
          value={viewMode()}
          onChange={(mode) => {
            setViewMode(mode);
            // The market search is hidden in Movers; keeping a live filter there
            // would silently shrink the table when the user comes back.
            if (mode === "movers") setSearch("");
            props.onViewChange?.(mode);
          }}
        />
        <Show when={viewMode() !== "movers"}>
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

      <Show when={showWarmingHint()}>
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

      <Show when={showErrorBanner()}>
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
            onClick={refresh}
            data-testid="market-error-banner-retry"
          >
            Retry
          </Button>
        </Box>
      </Show>

      <Show when={chips().length > 0}>
        <Box
          data-testid="market-active-chips"
          className="flex gap-1 flex-wrap flex-shrink-0"
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
        </Box>
      </Show>
      <Show
        when={props.symbolAllowlist && props.symbolAllowlist.length > 0}
      >
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

      <Box className="flex-1 min-h-0 flex gap-2 overflow-hidden">
        <Show when={!isNarrow() && !railCollapsed() && viewMode() !== "movers"}>
          <Box
            data-testid="market-rail-panel"
            className="w-[240px] flex-shrink-0 min-h-0 overflow-y-auto border border-fin-border rounded-sm bg-fin-surface"
          >
            <MarketFilterRail
              filters={filters()}
              onChange={patchFilters}
              sectors={sectors()}
              tierCounts={tierCounts()}
              onCollapse={isNarrow() ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
              collapseLabel={isNarrow() ? "Close filters" : "Collapse filters"}
            />
          </Box>
        </Show>

        <Box className="flex-1 min-w-0 min-h-0 flex flex-col">
          {viewMode() === "movers" ? (
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
                        onClick={refresh}
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
                    className={
                      viewMode() === "map"
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
                    />
                  </Box>
                  <Show when={viewMode() === "map"}>
                    <MarketMapView
                      rows={filteredRows()}
                      onSymbolClick={selectAndOpen}
                      sort={filters().sort}
                      onSortChange={(sort) => patchFilters({ sort })}
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
        <Show when={isWide()}>
          <ChartDockOutlet class="flex-shrink-0 basis-[38%] min-w-80 max-w-3xl min-h-0 empty:hidden" />
        </Show>
      </Box>

      <Show when={isNarrow() && drawerOpen()}>
        <Box
          data-testid="market-filter-drawer"
          className="fixed inset-0 z-50 flex"
          style={{ "z-index": 1050 }}
          onClick={() => setDrawerOpen(false)}
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
              onCollapse={isNarrow() ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
              collapseLabel={isNarrow() ? "Close filters" : "Collapse filters"}
            />
          </Box>
        </Box>
      </Show>
    </Box>
  );
}
