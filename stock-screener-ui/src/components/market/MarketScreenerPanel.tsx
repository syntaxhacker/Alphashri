import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
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
import { MarketFilterRail } from "./MarketFilterRail";
import { MarketMapView, MarketViewToggle, type MarketViewMode } from "./MarketMapView";
import { TanStackTable } from "../common/TanStackTable";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { useSymbolDock } from "../common/symbolDockContext";

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
  getRowStyle: (row: MarketRow) => { backgroundColor: string } | undefined;
  getRowTestId: (row: MarketRow) => string;
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

export function MarketScreenerPanel() {
  const [universe, setUniverse] = createSignal<MarketUniverse>(DEFAULT_MARKET_UNIVERSE);
  const [search, setSearch] = createSignal("");
  const [filters, setFilters] = createSignal<MarketFilterState>(defaultMarketFilters());
  const [railCollapsed, setRailCollapsed] = createSignal(false);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<MarketViewMode>("table");
  const [selectedSymbol, setSelectedSymbol] = createSignal<string | null>(null);
  const dock = useSymbolDock();
  const isNarrow = useMediaQuery("(max-width: 1023px)");

  const { rows, total, updateMode, asOf, isLoading, error, refresh, stale: cachedStale, warming } =
    useMarketSnapshotSolid(universe);

  // Filters belong to one universe's snapshot; carrying them across a universe
  // switch silently hides every row of the new universe.
  let prevUniverse = universe();
  createEffect(() => {
    const u = universe();
    if (u !== prevUniverse) {
      prevUniverse = u;
      setFilters(defaultMarketFilters());
      setSearch("");
    }
  });

  // Filters/search drive the table directly — Solid's keyed rows only
  // reconcile what changed, so no deferred copies are needed. Filter and sort
  // are separate memos: the sort re-runs only when the filtered set (or the
  // sort key) changes.
  const filteredRows = createMemo(() =>
    sortMarketRows(
      filterOnlyMarketRows(rows(), { ...filters(), search: search() }),
      filters().sort,
    ),
  );
  const matchCount = createMemo(
    () => filterOnlyMarketRows(rows(), { ...filters(), search: search() }).length,
  );
  const chips = createMemo(
    () => buildMarketFilterChips({ ...filters(), search: search() }),
  );
  const activeCount = createMemo(
    () => countActiveMarketFilters({ ...filters(), search: search() }),
  );
  const sectors = createMemo(() => marketSectors(rows()));
  const tierCounts = createMemo(() => countByCapTier(rows()));
  const columns = createMemo(() => buildMarketColumns());
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
          return { ...f, mcapMinCr: null };
        case "rsi":
          return { ...f, rsiMin: null, rsiMax: null };
        case "relvol":
          return { ...f, relVolMin: null };
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
          return { ...f, sector: null };
        default:
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

  const handleRowClick = (row: MarketRow) => {
    setSelectedSymbol(row.symbol);
    dock.open(row.symbol);
  };

  const getRowStyle = (row: MarketRow) =>
    row.symbol === selectedSymbol()
      ? { backgroundColor: "rgba(88, 166, 255, 0.12)" }
      : undefined;

  const getRowTestId = (row: MarketRow) => `market-row-${row.symbol}`;

  const rail = () => (
    <MarketFilterRail
      filters={filters()}
      onChange={patchFilters}
      sectors={sectors()}
      tierCounts={tierCounts()}
      onCollapse={isNarrow() ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
      collapseLabel={isNarrow() ? "Close filters" : "Collapse filters"}
    />
  );

  return (
    <Box
      data-testid="market-screener"
      className="flex-1 h-full min-w-0 min-h-0 flex flex-col gap-1 overflow-hidden"
    >
      <Paper
        elevation={0}
        data-testid="market-toolbar"
        className="flex items-center gap-1 px-2 h-[48px] min-h-[48px] max-h-[48px] border border-fin-border rounded-sm bg-fin-surface flex-shrink-0 overflow-hidden"
      >
        <Select
          value={universe()}
          onChange={(v) => v && setUniverse(v as MarketUniverse)}
          data={UNIVERSE_OPTIONS}
          size="xs"
          w={120}
          searchable
          aria-label="Market universe"
          data-testid="market-universe-select"
        />
        <TextInput
          placeholder="Search symbol or name…"
          size="xs"
          w={210}
          value={search()}
          onChange={(value: string) => setSearch(value)}
          leftSection={<IconSearch size={12} />}
          aria-label="Search symbols"
          data-testid="market-search"
        />
        <Tooltip label={modeBadge().hint}>
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
        <Tooltip label="Refresh snapshot">
          <span>
            <ActionIcon
              variant="subtle"
              size="sm"
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
        <Indicator
          label={String(activeCount())}
          color="primary"
          size={14}
          disabled={activeCount() === 0}
          data-testid="market-filter-count"
        >
          <Tooltip label={isNarrow() ? "Open filters" : railCollapsed() ? "Show filters" : "Hide filters"}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={handleToggleRail}
              aria-label={isNarrow() ? "Open filters" : "Toggle filters"}
              aria-pressed={isNarrow() ? drawerOpen() : !railCollapsed()}
              data-testid="market-rail-toggle"
            >
              <IconFilter size={14} />
            </ActionIcon>
          </Tooltip>
        </Indicator>
        <MarketViewToggle value={viewMode()} onChange={setViewMode} />
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconX size={12} />}
          onClick={resetFilters}
          data-testid="market-reset"
        >
          Reset
        </Button>
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
              <IconX size={10} />
            </Box>
          )}</For>
        </Box>
      </Show>

      <Box className="flex-1 min-h-0 flex gap-2 overflow-hidden">
        <Show when={!isNarrow() && !railCollapsed()}>
          <Box
            data-testid="market-rail-panel"
            className="w-[240px] flex-shrink-0 min-h-0 overflow-y-auto border border-fin-border rounded-sm bg-fin-surface"
          >
            {rail()}
          </Box>
        </Show>

        <Box
          className="flex-1 min-w-0 min-h-0 flex flex-col"
        >
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
                    <IconAlertCircle size={22} />
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
                <Show
                  when={viewMode() === "map"}
                  fallback={
                    <MarketGrid
                      data={filteredRows()}
                      columns={columns()}
                      hasActiveFilters={hasActiveFilters()}
                      onResetFilters={resetFilters}
                      onRowClick={handleRowClick}
                      getRowStyle={getRowStyle}
                      getRowTestId={getRowTestId}
                    />
                  }
                >
                  <MarketMapView
                    rows={filteredRows()}
                    onSymbolClick={(symbol) => {
                      setSelectedSymbol(symbol);
                      dock.open(symbol);
                    }}
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
        </Box>
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
            {rail()}
          </Box>
        </Box>
      </Show>
    </Box>
  );
}
