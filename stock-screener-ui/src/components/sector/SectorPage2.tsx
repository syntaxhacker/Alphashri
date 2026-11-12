import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Box, cn, Group, Text, Button, Stack, Tabs, Loader, SegmentedControl, ScrollArea, ToolbarRow } from "@/ui";
import {
  IconChartBar,
  IconArrowsExchange,
  IconRefresh,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
  IconNetwork,
} from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import { IntervalMoversTable } from "./IntervalMoversTable";
import { SectorCorrelationTab } from "./SectorCorrelationTab";
import { RotationTab } from "./RotationTab";
import { fetchSectorPerformance } from "../../api/sector";
import { fetchHeatmapData } from "../../api/heatmap";
import type { HeatmapStock } from "../../api/heatmap";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketOpenNow } from "../../state/holidays";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { CompactPanel } from "../common/compact";
import { formatPercentage } from "../../utils/ui-helpers";
import { detectSectorAlerts, detectIntervalMovers } from "./SectorHelpers";
import type { SectorAlert, InternalStockMover } from "./SectorHelpers";
import { SectorHeatmapView } from "./SectorHeatmapView";
import { SectorAlertsList } from "./SectorAlertsList";
import type { ViewMode } from "./SectorHeatmapView";

const SECTOR_TABS = ["dashboard", "correlation", "rotation"] as const;

type SectorTab = (typeof SECTOR_TABS)[number];
type DashboardView = "table" | "visual";

function isSectorTab(value: string | null): value is SectorTab {
  return value !== null && (SECTOR_TABS as readonly string[]).includes(value);
}

/** Read `?tab=` without pulling in React Router (tests render the page bare). */
function readTabFromUrl(): SectorTab {
  if (typeof window === "undefined") return "dashboard";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return isSectorTab(tab) ? tab : "dashboard";
}

/** Write `?tab=` while preserving every other query param and the hash. */
function writeTabToUrl(tab: SectorTab): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tab);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readDashboardView(): DashboardView {
  if (typeof window === "undefined") return "table";
  return new URLSearchParams(window.location.search).get("dash") === "visual" ? "visual" : "table";
}

function writeDashboardView(view: DashboardView): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (view === "visual") url.searchParams.set("dash", "visual");
  else url.searchParams.delete("dash");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function AlertsAndMovers({
  alerts,
  intervalMovers,
  topStocks,
}: {
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  topStocks: StockMover[];
}) {
  return (
    <Stack
      spacing={0.25}
      className="flex h-full min-h-0 flex-1 items-stretch overflow-hidden"
    >
      <CompactPanel
        id="sector-alerts-card"
        data-testid="sector-alerts-card"
        className="flex min-h-0 flex-none flex-col"
        title={
          <Box className="flex items-center justify-between gap-2">
            <Text fw={600} className="text-[11px]">Real-time Alerts</Text>
            <IconBellRinging size={14} color="var(--color-fin-warning)" />
          </Box>
        }
      >
        <ScrollArea flex={1}>
          <SectorAlertsList alerts={alerts} />
        </ScrollArea>
      </CompactPanel>

      <CompactPanel
        id="sector-interval-movers-card"
        data-testid="sector-interval-movers-card"
        className="flex min-h-0 flex-none flex-col"
        title={
          <Box className="flex items-center justify-between gap-2">
            <Text fw={600} className="text-[11px]">Interval Movers</Text>
            <IconTrendingUp size={14} color="var(--color-fin-primary)" />
          </Box>
        }
      >
        <ScrollArea flex={1}>
          <IntervalMoversTable movers={intervalMovers} />
        </ScrollArea>
      </CompactPanel>

      <CompactPanel
        id="sector-top-stocks-card"
        data-testid="sector-top-stocks-card"
        className="flex min-h-0 flex-1 flex-col"
        title={
          <Box className="flex items-center justify-between gap-2">
            <Text fw={600} className="text-[11px]">Top Gainers</Text>
            <IconTrendingUp size={14} color="var(--color-fin-positive)" />
          </Box>
        }
      >
        <ScrollArea flex={1}>
          {topStocks.length === 0 ? (
            <Box className="flex items-center justify-center p-1">
              <Text size="xs" c="dimmed">No movers</Text>
            </Box>
          ) : (
            <Stack spacing={0.25}>
              {topStocks.slice(0, 10).map((stock) => (
                <Box
                  key={stock.symbol}
                  className="flex min-w-0 items-center gap-1.5 px-1 py-[2px]"
                >
                  <Box
                    component="a"
                    href={`/chart/${encodeURIComponent(stock.symbol)}`}
                    className="min-w-0 text-fin-text no-underline hover:text-fin-primary"
                  >
                    <Text truncate className="text-[10.5px] font-semibold">
                      {stock.symbol}
                    </Text>
                  </Box>
                  <Box className="flex-1" />
                  <Text c={stock.change >= 0 ? "success.main" : "error.main"} className="text-[10.5px] tabular-nums">
                    {formatPercentage(stock.change)}
                  </Text>
                </Box>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </CompactPanel>
    </Stack>
  );
}

function LoadingPanel() {
  return (
    <CompactPanel
      title={
        <Group gap="xs" wrap="nowrap" align="center">
          <Loader size="sm" />
          <Text fw={600} size="sm">
            Fetching sector performance
          </Text>
        </Group>
      }
      description="Loading live sector breadth and movers."
      className="min-h-[400px]"
    >
      <Box flex={1} className="min-h-0" />
    </CompactPanel>
  );
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <CompactPanel
      title="Error"
      description={error}
      action={
        <Button variant="filled" color="error" size="sm" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      <Box flex={1} />
    </CompactPanel>
  );
}

function EmptyPanel() {
  return (
    <CompactPanel title="No sector data" description="No sector data available for this market.">
      <Box flex={1} />
    </CompactPanel>
  );
}

function SectorPerformancePanel({ sectors, gridArea: _gridArea }: { sectors: SectorItem[]; gridArea: string }) {
  return (
    <Box
      className="flex flex-col overflow-hidden border border-fin-border rounded-[2px] min-w-0 min-h-0"
    >
      <Box className="flex h-6 shrink-0 items-center border-b border-fin-border px-2">
        <Text fw={600} className="text-[11px]">Sector Performance</Text>
      </Box>
      <Box
        id="sector-table-container"
        data-testid="sector-table-container"
        className="min-h-0 flex-1 overflow-auto"
      >
        <SectorTable sectors={sectors} />
      </Box>
    </Box>
  );
}

function DashboardContent({
  data,
  alerts,
  intervalMovers,
  viewMode,
  onViewModeChange,
  heatmapStocks,
  heatmapMetric,
  onHeatmapMetricChange,
  stockSectorFilter,
  onStockSectorFilterChange,
  sectorOptions,
  heatmapLoading,
  dashboardView,
  onDashboardViewChange,
}: {
  data: SectorResponse;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  onHeatmapMetricChange: (metric: string) => void;
  stockSectorFilter: string | null;
  onStockSectorFilterChange: (sector: string | null) => void;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
}) {
  const bottomSector = data.sectors[data.sectors.length - 1];
  const totalAdvances = data.sectors.reduce((acc, s) => acc + s.advances, 0);
  const totalDeclines = data.sectors.reduce((acc, s) => acc + s.declines, 0);

  return (
    <Box
      className="flex-1 min-h-0 overflow-y-auto lg:overflow-y-hidden flex flex-col gap-[2px] p-[2px]"
    >
      <Box
        data-testid="sector-summary-strip"
        className="flex items-center flex-wrap gap-2 min-h-[28px] px-[6px] py-[2px] border border-fin-border rounded-[1px] bg-fin-surface shrink-0"
      >
        <Box className="flex min-w-0 items-baseline gap-1">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px]">
            Top Sector
          </Text>
          <Text fw={700} c="success.main" truncate className="text-[11px]">
            {data.sectors[0].sector}
          </Text>
          <Text c="dimmed" className="text-[9.5px] tabular-nums">
            Avg Change: {formatPercentage(data.sectors[0].avg_change)}
          </Text>
        </Box>
        <Box className="h-3 w-px shrink-0 bg-fin-border" />
        <Box className="flex items-baseline gap-[6px]">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px]">
            Market Breadth
          </Text>
          <Text fw={700} c="success.main" className="text-[11px] tabular-nums">
            {totalAdvances} UP
          </Text>
          <Text fw={700} c="error.main" className="text-[11px] tabular-nums">
            {totalDeclines} DOWN
          </Text>
        </Box>
        <Box className="h-3 w-px shrink-0 bg-fin-border" />
        <Box className="flex min-w-0 items-baseline gap-1">
          <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px]">
            Weakest Sector
          </Text>
          <Text fw={700} c="error.main" truncate className="text-[11px]">
            {bottomSector.sector}
          </Text>
          <Text c="dimmed" className="text-[9.5px] tabular-nums">
            Avg Change: {formatPercentage(bottomSector.avg_change)}
          </Text>
        </Box>
        <Box className="flex-1" />
        <Box
          data-testid="sector-dashboard-view-toggle"
          className="flex h-[22px] border border-fin-border rounded-[1px] overflow-hidden"
        >
          {(["table", "visual"] as const).map((view) => (
            <Box
              key={view}
              component="button"
              type="button"
              aria-pressed={dashboardView === view}
              onClick={() => onDashboardViewChange(view)}
              className={cn(
                "px-[6px] border-0 cursor-pointer text-[9.5px] font-semibold leading-none",
                dashboardView === view ? "bg-fin-primary/10 text-fin-primary" : "bg-transparent text-fin-text-muted",
                "hover:bg-fin-primary/10",
              )}
            >
              {view === "table" ? "Table" : "Visual"}
            </Box>
          ))}
        </Box>
      </Box>

      {dashboardView === "visual" ? (
        <Box
          className="flex-1 min-h-0 grid gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)] grid-rows-[auto_auto_auto] lg:grid-rows-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
        >
          <CompactPanel
            id="sector-heatmap-panel"
            data-testid="sector-heatmap-panel"
            padded={false}
            className="min-h-[300px] lg:min-h-0 flex flex-col"
            title={
              <Box className="flex items-center justify-between gap-2">
                <Text fw={600} className="text-[11px]">Market Heatmap</Text>
                {data.last_updated && (
                  <Box className="flex items-center gap-1">
                    <IconClock size={10} color="var(--color-fin-text-muted)" />
                    <Text c="dimmed" className="text-[9.5px] tabular-nums">
                      {new Date(data.last_updated).toLocaleTimeString()}
                    </Text>
                  </Box>
                )}
              </Box>
            }
          >
            <SectorHeatmapView
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              sectors={data.sectors}
              stocks={heatmapStocks}
              metric={heatmapMetric}
              onMetricChange={onHeatmapMetricChange}
              sectorFilter={stockSectorFilter}
              sectorOptions={sectorOptions}
              onSectorFilterChange={onStockSectorFilterChange}
              lastUpdated={data.last_updated}
              loading={heatmapLoading}
            />
          </CompactPanel>

          <SectorPerformancePanel sectors={data.sectors} gridArea="table" />

          <Box
            className="min-h-[360px] lg:min-h-0 min-w-0 flex flex-col"
          >
            <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} topStocks={data.top_stock_movers} />
          </Box>
        </Box>
      ) : (
        <Box
          className="flex-1 min-h-0 grid gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)] grid-rows-[auto_auto] lg:grid-rows-[minmax(0,1fr)]"
        >
          <SectorPerformancePanel sectors={data.sectors} gridArea="table" />
          <Box
            className="min-h-[360px] lg:min-h-0 min-w-0 flex flex-col"
          >
            <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} topStocks={data.top_stock_movers} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

function processSectorResponse(
  response: SectorResponse,
  prevSectorData: Record<string, number>,
  prevStockData: Record<string, number>,
  setAlerts: React.Dispatch<React.SetStateAction<SectorAlert[]>>,
  setIntervalMovers: React.Dispatch<React.SetStateAction<InternalStockMover[]>>,
) {
  const sectors = response.sectors ?? [];
  const newAlerts = detectSectorAlerts(sectors, prevSectorData);
  sectors.forEach((item: SectorItem) => {
    prevSectorData[item.sector] = item.avg_change;
  });
  if (newAlerts.length > 0) {
    setAlerts((prev) => [...newAlerts, ...prev].slice(0, 10));
  }
  const stockMovers = response.top_stock_movers ?? [];
  const newIntervalMovers = detectIntervalMovers(stockMovers, prevStockData);
  stockMovers.forEach((item: StockMover) => {
    prevStockData[item.symbol] = item.change;
  });
  if (newIntervalMovers.length > 0) {
    setIntervalMovers(newIntervalMovers.slice(0, 10));
  }
}

interface SectorState {
  data: SectorResponse | null;
  setData: Dispatch<SetStateAction<SectorResponse | null>>;
  loading: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  market: "india" | "america";
  setMarket: Dispatch<SetStateAction<"india" | "america">>;
  activeTab: SectorTab;
  setActiveTab: (tab: string | null) => void;
  alerts: SectorAlert[];
  setAlerts: Dispatch<SetStateAction<SectorAlert[]>>;
  intervalMovers: InternalStockMover[];
  setIntervalMovers: Dispatch<SetStateAction<InternalStockMover[]>>;
  prevSectorDataRef: MutableRefObject<Record<string, number>>;
  prevStockDataRef: MutableRefObject<Record<string, number>>;
  requestAbortRef: MutableRefObject<AbortController | null>;
}

function useSectorState(): SectorState {
  const [data, setData] = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"india" | "america">("india");
  const [activeTab, setActiveTabState] = useState<SectorTab>(readTabFromUrl);
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = useState<InternalStockMover[]>([]);
  const prevSectorDataRef = useRef<Record<string, number>>({});
  const prevStockDataRef = useRef<Record<string, number>>({});
  const requestAbortRef = useRef<AbortController | null>(null);

  const setActiveTab = useCallback((next: string | null) => {
    if (!isSectorTab(next)) return;
    setActiveTabState(next);
    writeTabToUrl(next);
  }, []);

  return {
    data,
    setData,
    loading,
    setLoading,
    error,
    setError,
    market,
    setMarket,
    activeTab,
    setActiveTab,
    alerts,
    setAlerts,
    intervalMovers,
    setIntervalMovers,
    prevSectorDataRef,
    prevStockDataRef,
    requestAbortRef,
  };
}

function useSectorLoadData(state: SectorState) {
  const {
    requestAbortRef,
    setLoading,
    setError,
    setData,
    setAlerts,
    setIntervalMovers,
    prevSectorDataRef,
    prevStockDataRef,
  } = state;

  const loadData = useCallback(
    async (mkt: string, isInitial = false, force = false): Promise<boolean> => {
      if (requestAbortRef.current) {
        // A manual refresh supersedes whatever is in flight; a background poll
        // yields to it instead of stacking a second upstream scan.
        if (!isInitial && !force) return false;
        requestAbortRef.current.abort();
      }
      const controller = new AbortController();
      requestAbortRef.current = controller;
      if (isInitial) setLoading(true);
      setError(null);
      try {
        const res = await fetchSectorPerformance(mkt, controller.signal, force);
        if (controller.signal.aborted) return false;
        processSectorResponse(
          res,
          prevSectorDataRef.current,
          prevStockDataRef.current,
          setAlerts,
          setIntervalMovers,
        );
        setData(res);
        return true;
      } catch (err) {
        if (controller.signal.aborted) return false;
        setError(err instanceof Error ? err.message : "Failed to load sector data");
        return true;
      } finally {
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
          setLoading(false);
        }
      }
    },
    [
      setLoading,
      setError,
      setData,
      setAlerts,
      setIntervalMovers,
      prevSectorDataRef,
      prevStockDataRef,
      requestAbortRef,
      fetchSectorPerformance,
      processSectorResponse,
    ],
  );

  return loadData;
}

function useSectorPolling(
  state: SectorState,
  loadData: (mkt: string, isInitial?: boolean, force?: boolean) => Promise<boolean>,
) {
  const { activeTab, market, setLoading, requestAbortRef } = state;

  useEffect(() => {
    if (activeTab !== "dashboard") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let fastPollCount = 0;
    const liveTimeoutRef = { current: null as ReturnType<typeof setTimeout> | null };

    const scheduleNextPoll = (delay: number) => {
      if (cancelled) return;
      liveTimeoutRef.current = setTimeout(() => {
        if (cancelled) return;
        if (!isMarketOpenNow()) return;
        void loadData(market).then((completed) => {
          if (cancelled || !completed) return;
          fastPollCount += 1;
          scheduleNextPoll(fastPollCount < 2 ? 5000 : 60000);
        });
      }, delay);
    };

    void loadData(market, true).then((completed) => {
      if (!cancelled && completed) {
        scheduleNextPoll(5000);
      }
    });

    return () => {
      cancelled = true;
      if (liveTimeoutRef.current) clearTimeout(liveTimeoutRef.current);
      requestAbortRef.current?.abort();
    };
  }, [activeTab, market, loadData, setLoading, requestAbortRef]);
}

function useSectorData() {
  const state = useSectorState();
  const loadData = useSectorLoadData(state);
  useSectorPolling(state, loadData);
  return { ...state, loadData };
}

function SectorPageHeader({
  market,
  setMarket,
  loading,
  onRefresh,
  showRefresh,
}: {
  market: "india" | "america";
  setMarket: (m: "india" | "america") => void;
  loading: boolean;
  onRefresh: () => void;
  showRefresh: boolean;
}) {
  const marketOpen = isMarketOpenNow();
  return (
    <ToolbarRow
      gap={8}
      data-testid="sector-header"
      style={{ padding: "0 12px", "min-height": 36, height: 36, borderBottom: "1px solid var(--color-fin-border)", "flex-shrink": 0 }}
    >
      <Text fw={700} className="text-[12px] whitespace-nowrap">
        Sector Dashboard
      </Text>
      <Text c="dimmed" className="text-[10px] whitespace-nowrap">
        Real-time sector performance and technical strength.
      </Text>
      {!marketOpen ? (
        <Text
          c="warning"
          fw={700}
          title="Showing the last available session snapshot"
          className="text-[9.5px] whitespace-nowrap tracking-[0.4px]"
        >
          MARKET CLOSED
        </Text>
      ) : null}
      <Box className="flex-1" />
      <SegmentedControl
        value={market}
        onChange={(v) => setMarket(v as "india" | "america")}
        data={[
          { label: "India", value: "india" },
          { label: "US", value: "america" },
        ]}
        size="xs"
        data-testid="sector-market-selector"
      />
      {showRefresh ? (
        <Button
          variant="light"
          color="secondary"
          size="xs"
          leftSection={<IconRefresh size={12} />}
          onClick={onRefresh}
          loading={loading}
          disabled={!marketOpen}
          title={!marketOpen ? "Market is closed" : undefined}
          data-testid="sector-refresh-btn"
        >
          Refresh
        </Button>
      ) : null}
    </ToolbarRow>
  );
}

function SectorTabContent({
  activeTab,
  data,
  loading,
  error,
  market,
  alerts,
  intervalMovers,
  loadData,
  viewMode,
  onViewModeChange,
  heatmapStocks,
  heatmapMetric,
  onHeatmapMetricChange,
  stockSectorFilter,
  onStockSectorFilterChange,
  sectorOptions,
  heatmapLoading,
  dashboardView,
  onDashboardViewChange,
}: {
  activeTab: SectorTab;
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: "india" | "america";
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  loadData: (m: string, isInitial?: boolean, force?: boolean) => Promise<boolean>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  onHeatmapMetricChange: (metric: string) => void;
  stockSectorFilter: string | null;
  onStockSectorFilterChange: (sector: string | null) => void;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
}) {
  if (activeTab === "rotation") {
    return <RotationTab market={market} />;
  }
  if (activeTab === "correlation") {
    return <SectorCorrelationTab />;
  }
  if (loading && !data) return <LoadingPanel />;
  if (error) return <ErrorPanel error={error} onRetry={() => loadData(market)} />;
  if (!data || data.sectors.length === 0) return <EmptyPanel />;
  return (
    <DashboardContent
      data={data}
      alerts={alerts}
      intervalMovers={intervalMovers}
      viewMode={viewMode}
      onViewModeChange={onViewModeChange}
      heatmapStocks={heatmapStocks}
      heatmapMetric={heatmapMetric}
      onHeatmapMetricChange={onHeatmapMetricChange}
      stockSectorFilter={stockSectorFilter}
      onStockSectorFilterChange={onStockSectorFilterChange}
      sectorOptions={sectorOptions}
      heatmapLoading={heatmapLoading}
      dashboardView={dashboardView}
      onDashboardViewChange={onDashboardViewChange}
    />
  );
}

export function SectorPage() {
  useStoreSubscription(subscribeToHolidays);
  const state = useSectorData();

  const [viewMode, setViewMode] = useState<ViewMode>("sector");
  const [dashboardView, setDashboardView] = useState<DashboardView>(readDashboardView);
  const [heatmapMetric, setHeatmapMetric] = useState("change_pct");
  const [stockSectorFilter, setStockSectorFilter] = useState<string | null>(null);
  const [heatmapStocks, setHeatmapStocks] = useState<HeatmapStock[]>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  useEffect(() => {
    if (viewMode !== "stock") return;
    const controller = new AbortController();
    setHeatmapLoading(true);
    fetchHeatmapData(undefined, undefined, stockSectorFilter || undefined, 500, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) {
          setHeatmapStocks(res.stocks);
          setHeatmapLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setHeatmapStocks([]);
          setHeatmapLoading(false);
        }
      });
    return () => controller.abort();
  }, [viewMode, stockSectorFilter]);

  const sectorOptions = useMemo(() => {
    const unique = [...new Set(heatmapStocks.map((s) => s.sector).filter(Boolean))];
    return unique.map((s) => ({ value: s, label: s }));
  }, [heatmapStocks]);

  return (
    <Box
      data-testid="sector-analysis-view"
      className="w-full h-full min-h-0 flex flex-col p-0 gap-0 overflow-hidden"
    >
      <SectorPageHeader
        market={state.market}
        setMarket={state.setMarket}
        loading={state.loading}
        onRefresh={() => state.loadData(state.market, false, true)}
        showRefresh={state.activeTab === "dashboard"}
      />
      <Box className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Box
          id="sector-page"
          className="flex-1 min-h-0 flex flex-col overflow-hidden w-full"
        >
          <Box className="flex h-6 shrink-0 items-center border-b border-fin-border px-2">
            <Tabs
              value={state.activeTab}
              onChange={state.setActiveTab}
              className="min-h-[24px]"
            >
              <Tabs.List className="flex items-center gap-1">
                <Tabs.Tab value="dashboard" className="min-h-[24px] py-0 text-[11px]" icon={<IconChartBar size={12} />}>
                  Live Dashboard
                </Tabs.Tab>
                <Tabs.Tab value="correlation" className="min-h-[24px] py-0 text-[11px]" icon={<IconNetwork size={12} />}>
                  Sector Correlation
                </Tabs.Tab>
                <Tabs.Tab value="rotation" className="min-h-[24px] py-0 text-[11px]" icon={<IconArrowsExchange size={12} />}>
                  Rotation
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Box>
          <Box flex={1} className="min-h-0 overflow-auto flex flex-col items-stretch">
            <SectorTabContent
              activeTab={state.activeTab}
              data={state.data}
              loading={state.loading}
              error={state.error}
              market={state.market}
              alerts={state.alerts}
              intervalMovers={state.intervalMovers}
              loadData={state.loadData}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              heatmapStocks={heatmapStocks}
              heatmapMetric={heatmapMetric}
              onHeatmapMetricChange={setHeatmapMetric}
              stockSectorFilter={stockSectorFilter}
              onStockSectorFilterChange={setStockSectorFilter}
              sectorOptions={sectorOptions}
              heatmapLoading={heatmapLoading}
              dashboardView={dashboardView}
              onDashboardViewChange={(view) => {
                setDashboardView(view);
                writeDashboardView(view);
              }}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
