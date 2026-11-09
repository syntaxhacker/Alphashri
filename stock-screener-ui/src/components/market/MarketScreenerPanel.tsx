import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import Drawer from "@mui/material/Drawer";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Indicator,
  Loader,
  Paper,
  Select,
  Skeleton,
  Text,
  TextInput,
  Tooltip,
  useMediaQuery,
} from "@/ui";
import {
  IconAlertCircle,
  IconFilter,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { BORDER, SURFACE, FIN_HEADER_H } from "@/ui/palette";
import { formatNumberIN } from "@/utils/ui-helpers";
import { MARKET_UNIVERSES, DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import type { ColumnDef } from "@tanstack/react-table";
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
import { TanStackTable } from "../common/TanStackTable";
import { useMarketSnapshot } from "../../hooks/useMarketSnapshot";
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
const MarketGrid = memo(function MarketGrid({
  data,
  columns,
  hasActiveFilters,
  onResetFilters,
  onRowClick,
  getRowStyle,
  getRowTestId,
}: {
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
      data={data}
      columns={columns}
      dataTestId="market-grid"
      ariaLabel="Market screener results"
      rowWindowSize={80}
      fillContainer
      dense
      minTableWidth={1000}
      enableSorting
      stickyHeader
      initialState={{ sorting: [{ id: "market_cap_cr", desc: true }] }}
      onRowClick={onRowClick}
      getRowStyle={getRowStyle}
      getRowTestId={getRowTestId}
      emptyMessage={
        hasActiveFilters ? "No rows match the current filters" : "No market data"
      }
      emptyAction={
        hasActiveFilters ? (
          <Button
            size="xs"
            variant="subtle"
            onClick={onResetFilters}
            data-testid="market-empty-reset"
          >
            Reset filters
          </Button>
        ) : undefined
      }
    />
  );
});

export function MarketScreenerPanel() {
  const [universe, setUniverse] = useState<MarketUniverse>(DEFAULT_MARKET_UNIVERSE);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filters, setFilters] = useState<MarketFilterState>(() => defaultMarketFilters());
  const deferredFilters = useDeferredValue(filters);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const dock = useSymbolDock();
  const isNarrow = useMediaQuery("(max-width: 1023px)");

  const { rows, total, updateMode, asOf, isLoading, error, refresh, stale: cachedStale, warming } =
    useMarketSnapshot(universe);

  // Filters belong to one universe's snapshot; carrying them across a universe
  // switch silently hides every row of the new universe.
  useEffect(() => {
    setFilters(defaultMarketFilters());
    setSearch("");
  }, [universe]);

  // `filters`/`search` drive chips + the active-filter count + the match count
  // immediately; the table consumes deferred copies so a filter click never
  // blocks on re-rendering the full row set. Filter and sort are separate
  // memos: the sort re-runs only when the filtered set (or the sort key)
  // changes — never on toolbar/rail re-renders.
  const deferredUnsorted = useMemo(
    () => filterOnlyMarketRows(rows, { ...deferredFilters, search: deferredSearch }),
    [rows, deferredFilters, deferredSearch],
  );
  const filteredRows = useMemo(
    () => sortMarketRows(deferredUnsorted, deferredFilters.sort),
    [deferredUnsorted, deferredFilters.sort],
  );
  // Count from the immediate filters (filter-only, no sort) — keeps the
  // toolbar honest with the chips on the same commit instead of lagging the
  // deferred table by one transition.
  const matchCount = useMemo(
    () => filterOnlyMarketRows(rows, { ...filters, search }).length,
    [rows, filters, search],
  );
  const chips = useMemo(
    () => buildMarketFilterChips({ ...filters, search }),
    [filters, search],
  );
  const activeCount = useMemo(
    () => countActiveMarketFilters({ ...filters, search }),
    [filters, search],
  );
  const sectors = useMemo(() => marketSectors(rows), [rows]);
  const tierCounts = useMemo(() => countByCapTier(rows), [rows]);
  const columns = useMemo(() => buildMarketColumns(), []);
  const stale = useMemo(
    () => cachedStale || isSnapshotStale(asOf),
    [cachedStale, asOf],
  );
  const hasActiveFilters = chips.length > 0;

  const patchFilters = useCallback(
    (patch: Partial<MarketFilterState>) => setFilters((f) => ({ ...f, ...patch })),
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters(defaultMarketFilters());
    setSearch("");
  }, []);

  const removeChip = useCallback((key: string) => {
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
  }, []);

  const handleToggleRail = useCallback(() => {
    if (isNarrow) {
      setDrawerOpen((open) => !open);
    } else {
      setRailCollapsed((collapsed) => !collapsed);
    }
  }, [isNarrow]);

  const showWarmingHint =
    universe === "all_equity" && warming && isLoading && error === null && rows.length === 0;

  const modeBadge = (() => {
    const mode = (updateMode ?? "").toLowerCase();
    if (mode === "streaming") {
      return { label: "Live", color: "success" as const, hint: "Live streaming feed" };
    }
    if (!updateMode) {
      return { label: "Unknown", color: "default" as const, hint: "Feed mode not reported" };
    }
    return { label: "Delayed", color: "warning" as const, hint: `Feed mode: ${updateMode}` };
  })();

  const showInitialLoading = isLoading && rows.length === 0;
  const showError = error !== null && rows.length === 0;
  const showErrorBanner = error !== null && !isLoading && rows.length > 0;

  // Stable callbacks: TanStackTable must not receive new function identities
  // on every render (that would destabilize row event handlers).
  const handleRowClick = useCallback(
    (row: MarketRow) => {
      setSelectedSymbol(row.symbol);
      dock.open(row.symbol);
    },
    [dock],
  );

  const getRowStyle = useCallback(
    (row: MarketRow) =>
      row.symbol === selectedSymbol
        ? { backgroundColor: "var(--mui-palette-action-selected)" }
        : undefined,
    [selectedSymbol],
  );

  const getRowTestId = useCallback((row: MarketRow) => `market-row-${row.symbol}`, []);

  const rail = (
    <MarketFilterRail
      filters={filters}
      onChange={patchFilters}
      sectors={sectors}
      tierCounts={tierCounts}
      onCollapse={isNarrow ? () => setDrawerOpen(false) : () => setRailCollapsed(true)}
      collapseLabel={isNarrow ? "Close filters" : "Collapse filters"}
    />
  );

  return (
    <Box
      data-testid="market-screener"
      sx={{
        flex: 1,
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        overflow: "hidden",
      }}
    >
      <Paper
        elevation={0}
        data-testid="market-toolbar"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1,
          height: FIN_HEADER_H,
          minHeight: FIN_HEADER_H,
          border: 1,
          borderColor: BORDER,
          borderRadius: 2,
          bgcolor: SURFACE,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <Select
          value={universe}
          onChange={(v) => v && setUniverse(v as MarketUniverse)}
          data={UNIVERSE_OPTIONS}
          size="xs"
          w={120}
          aria-label="Market universe"
          data-testid="market-universe-select"
        />
        <TextInput
          placeholder="Search symbol or name…"
          size="xs"
          w={210}
          value={search}
          onChange={(value: string) => setSearch(value)}
          leftSection={<IconSearch size={12} />}
          aria-label="Search symbols"
          data-testid="market-search"
        />
        <Tooltip label={modeBadge.hint}>
          <Badge
            size="xs"
            variant="light"
            color={modeBadge.color}
            data-testid="market-mode-badge"
          >
            {modeBadge.label}
          </Badge>
        </Tooltip>
        {stale ? (
          <Tooltip
            label={
              cachedStale && isLoading
                ? "Showing the last snapshot — refreshing in the background"
                : `Snapshot is older than 15 minutes (as of ${asOf ?? "unknown"})`
            }
          >
            <Badge size="xs" variant="outline" color="warning" data-testid="market-stale-badge">
              Stale
            </Badge>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Text
          size="xs"
          c="dimmed"
          truncate
          title={`${formatNumberIN(matchCount)} of ${formatNumberIN(rows.length)} loaded rows match (universe total ${formatNumberIN(total)})`}
          data-testid="market-result-count"
          sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}
        >
          {formatNumberIN(matchCount)} / {formatNumberIN(rows.length)}
        </Text>
        <Tooltip label="Refresh snapshot">
          <span>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={refresh}
              disabled={isLoading}
              aria-label="Refresh snapshot"
              data-testid="market-refresh"
            >
              {isLoading ? <Loader size={12} /> : <IconRefresh size={14} />}
            </ActionIcon>
          </span>
        </Tooltip>
        <Indicator
          label={String(activeCount)}
          color="primary"
          size={14}
          disabled={activeCount === 0}
          data-testid="market-filter-count"
        >
          <Tooltip label={isNarrow ? "Open filters" : railCollapsed ? "Show filters" : "Hide filters"}>
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={handleToggleRail}
              aria-label={isNarrow ? "Open filters" : "Toggle filters"}
              aria-pressed={isNarrow ? drawerOpen : !railCollapsed}
              data-testid="market-rail-toggle"
            >
              <IconFilter size={14} />
            </ActionIcon>
          </Tooltip>
        </Indicator>
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

      {showWarmingHint ? (
        <Box
          role="status"
          data-testid="market-warming-hint"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1,
            py: 0.5,
            flexShrink: 0,
            border: 1,
            borderColor: BORDER,
            borderRadius: 2,
            bgcolor: SURFACE,
          }}
        >
          <Loader size={12} />
          <Text size="xs" c="dimmed" data-testid="market-warming-hint-text">
            Still warming All NSE — switch to Nifty 500 for instant data
          </Text>
          <Box sx={{ flex: 1, minWidth: 0 }} />
          <Button
            size="xs"
            variant="subtle"
            onClick={() => setUniverse("nifty500")}
            data-testid="market-warming-switch"
          >
            Switch to Nifty 500
          </Button>
        </Box>
      ) : null}

      {showErrorBanner ? (
        <Box
          role="alert"
          data-testid="market-error-banner"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 1,
            py: 0.5,
            flexShrink: 0,
            border: 1,
            borderColor: BORDER,
            borderLeft: 3,
            borderLeftColor: "error.main",
            borderRadius: 2,
            bgcolor: SURFACE,
          }}
        >
          <IconAlertCircle size={14} />
          <Text size="xs" c="error" sx={{ flex: 1, minWidth: 0 }} data-testid="market-error-banner-message">
            Refresh failed: {error?.message}
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
      ) : null}

      {chips.length > 0 ? (
        <Box
          data-testid="market-active-chips"
          sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", flexShrink: 0 }}
        >
          {chips.map((chip) => (
            <Box
              key={chip.key}
              component="button"
              type="button"
              onClick={() => removeChip(chip.key)}
              aria-label={`Remove filter ${chip.label}`}
              data-testid={`market-filter-chip-${chip.key}`}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                height: 22,
                px: 0.75,
                borderRadius: 11,
                border: 1,
                borderColor: BORDER,
                bgcolor: SURFACE,
                color: "text.primary",
                font: "inherit",
                fontSize: 11,
                lineHeight: 1,
                cursor: "pointer",
                "&:hover": { borderColor: "primary.main", color: "primary.main" },
              }}
            >
              <Text size="xs" sx={{ lineHeight: 1 }}>
                {chip.label}
              </Text>
              <IconX size={10} />
            </Box>
          ))}
        </Box>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", gap: 1, overflow: "hidden" }}>
        {!isNarrow && !railCollapsed ? (
          <Box
            data-testid="market-rail-panel"
            sx={{
              width: 240,
              flexShrink: 0,
              minHeight: 0,
              overflowY: "auto",
              border: 1,
              borderColor: BORDER,
              borderRadius: 2,
              bgcolor: SURFACE,
            }}
          >
            {rail}
          </Box>
        ) : null}

        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {showInitialLoading ? (
            <Paper
              elevation={0}
              data-testid="market-skeleton"
              sx={{
                flex: 1,
                border: 1,
                borderColor: BORDER,
                borderRadius: 2,
                bgcolor: SURFACE,
                p: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
              }}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <Skeleton key={i} h={24} />
              ))}
            </Paper>
          ) : showError ? (
            <Paper
              elevation={0}
              role="alert"
              data-testid="market-error"
              sx={{
                flex: 1,
                border: 1,
                borderColor: BORDER,
                borderRadius: 2,
                bgcolor: SURFACE,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
                p: 3,
                textAlign: "center",
              }}
            >
              <IconAlertCircle size={22} />
              <Text size="sm" fw={600}>
                Couldn’t load the market snapshot
              </Text>
              <Text size="xs" c="dimmed" data-testid="market-error-message">
                {error?.message}
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
          ) : (
            <MarketGrid
              data={filteredRows}
              columns={columns}
              hasActiveFilters={hasActiveFilters}
              onResetFilters={resetFilters}
              onRowClick={handleRowClick}
              getRowStyle={getRowStyle}
              getRowTestId={getRowTestId}
            />
          )}
        </Box>
      </Box>

      <Drawer
        anchor="left"
        open={isNarrow && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        data-testid="market-filter-drawer"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
        slotProps={{ paper: { sx: { width: 280, bgcolor: SURFACE } } }}
      >
        {rail}
      </Drawer>
    </Box>
  );
}
