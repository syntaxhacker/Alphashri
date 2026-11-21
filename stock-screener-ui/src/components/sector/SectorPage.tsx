import { Show, For, createEffect, createMemo, createSignal, onCleanup, type Accessor, type Setter } from "solid-js";
import { Box, Group, Text, Button, Stack, Tabs, Loader, ScrollArea, ToolbarRow } from "@/ui";
import {
  IconChartBar,
  IconArrowsExchange,
  IconRefresh,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
  IconNetwork,
} from "../screener/icons";
import { SectorTable } from "./SectorTable";
import { IntervalMoversTable } from "./IntervalMoversTable";
import { SectorCorrelationTab } from "./SectorCorrelationTab";
import { RotationTab } from "./RotationTab";
import { fetchSectorPerformance } from "../../api/sector";
import { fetchHeatmapData } from "../../api/heatmap";
import type { HeatmapStock } from "../../api/heatmap";
import { subscribeToHolidays, isMarketOpenNow } from "../../state/holidays";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { CompactPanel } from "../common/compact";
import { formatPercentage } from "../../utils/ui-helpers";
import { detectSectorAlerts, detectIntervalMovers } from "./SectorHelpers";
import type { SectorAlert, InternalStockMover } from "./SectorHelpers";
import { SectorHeatmapView } from "./SectorHeatmapView";
import { SectorHeatmapControls } from "./SectorHeatmapContext";
import { CompactToggle } from "./CompactToggle";
import { SectorAlertsList } from "./SectorAlertsList";
import type { ViewMode } from "./SectorHeatmapView";

const SECTOR_TABS = ["dashboard", "correlation", "rotation"] as const;

type SectorTab = (typeof SECTOR_TABS)[number];
type DashboardView = "table" | "visual";

function isSectorTab(value: string | null): value is SectorTab {
  return value !== null && (SECTOR_TABS as readonly string[]).includes(value);
}

/** Read `?tab=` without pulling in the router (tests render the page bare). */
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

function AlertsAndMovers(props: {
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
          <SectorAlertsList alerts={props.alerts} />
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
          <IntervalMoversTable movers={props.intervalMovers} />
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
          <Show when={props.topStocks.length > 0} fallback={
            <Box className="flex items-center justify-center p-1">
              <Text size="xs" c="dimmed">No movers</Text>
            </Box>
          }>
            <Stack spacing={0.25}>
              <For each={props.topStocks.slice(0, 10)}>
                {(stock) => (
                  <Box
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
                    <Text c={stock.change >= 0 ? "success" : "error"} className="text-[10.5px] tabular-nums font-mono">
                      {formatPercentage(stock.change)}
                    </Text>
                  </Box>
                )}
              </For>
            </Stack>
          </Show>
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

function ErrorPanel(props: { error: string; onRetry: () => void }) {
  return (
    <CompactPanel
      title="Error"
      description={props.error}
      action={
        <Button variant="filled" color="error" size="sm" onClick={props.onRetry}>
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

function SectorPerformancePanel(props: { sectors: SectorItem[] }) {
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
        <SectorTable sectors={props.sectors} />
      </Box>
    </Box>
  );
}

function DashboardContent(props: {
  data: SectorResponse;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  viewMode: ViewMode;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  dashboardView: DashboardView;
}) {
  const data = () => props.data;

  return (
    <Box
      className="flex-1 min-h-0 overflow-y-auto lg:overflow-y-hidden flex flex-col gap-[2px] p-[2px]"
    >
      <Show when={props.dashboardView === "visual"} fallback={
        <Box
          className="flex-1 min-h-0 grid gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)] grid-rows-[auto_auto] lg:grid-rows-[minmax(0,1fr)]"
        >
          <SectorPerformancePanel sectors={data().sectors} />
          <Box
            className="min-h-[360px] lg:min-h-0 min-w-0 flex flex-col"
          >
            <AlertsAndMovers alerts={props.alerts} intervalMovers={props.intervalMovers} topStocks={data().top_stock_movers} />
          </Box>
        </Box>
      }>
        <Box
          className="flex-1 min-h-0 grid gap-[2px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2.4fr)_minmax(320px,1fr)] grid-rows-[auto_auto_auto] lg:grid-rows-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
        >
          <CompactPanel
            id="sector-heatmap-panel"
            data-testid="sector-heatmap-panel"
            padded={false}
            scrollable
            className="min-h-[300px] lg:min-h-0 flex flex-col"
            title={
              <Box className="flex items-center justify-between gap-2">
                <Text fw={600} className="text-[11px]">Market Heatmap</Text>
                <Show when={data().last_updated}>
                  <Box className="flex items-center gap-1">
                    <IconClock size={12} color="var(--color-fin-text-muted)" />
                    <Text c="dimmed" className="text-[9.5px] font-mono tabular-nums">
                      {new Date(data().last_updated!).toLocaleTimeString()}
                    </Text>
                  </Box>
                </Show>
              </Box>
            }
          >
            <SectorHeatmapView
              viewMode={props.viewMode}
              sectors={data().sectors}
              stocks={props.heatmapStocks}
              metric={props.heatmapMetric}
            />
          </CompactPanel>

          <SectorPerformancePanel sectors={data().sectors} />

          <Box
            className="min-h-[360px] lg:min-h-0 min-w-0 flex flex-col"
          >
            <AlertsAndMovers alerts={props.alerts} intervalMovers={props.intervalMovers} topStocks={data().top_stock_movers} />
          </Box>
        </Box>
      </Show>
    </Box>
  );
}

function processSectorResponse(
  response: SectorResponse,
  prevSectorData: Record<string, number>,
  prevStockData: Record<string, number>,
  setAlerts: (fn: (prev: SectorAlert[]) => SectorAlert[]) => void,
  setIntervalMovers: (movers: InternalStockMover[]) => void,
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
  data: Accessor<SectorResponse | null>;
  setData: Setter<SectorResponse | null>;
  loading: Accessor<boolean>;
  setLoading: Setter<boolean>;
  error: Accessor<string | null>;
  setError: Setter<string | null>;
  market: Accessor<"india" | "america">;
  setMarket: Setter<"india" | "america">;
  activeTab: Accessor<SectorTab>;
  setActiveTab: (tab: string | null) => void;
  alerts: Accessor<SectorAlert[]>;
  setAlerts: Setter<SectorAlert[]>;
  intervalMovers: Accessor<InternalStockMover[]>;
  setIntervalMovers: Setter<InternalStockMover[]>;
  prevSectorData: Record<string, number>;
  prevStockData: Record<string, number>;
  requestAbort: { current: AbortController | null };
}

function useSectorState(): SectorState {
  const [data, setData] = createSignal<SectorResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [market, setMarket] = createSignal<"india" | "america">("india");
  const [activeTabState, setActiveTabState] = createSignal<SectorTab>(readTabFromUrl());
  const [alerts, setAlerts] = createSignal<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = createSignal<InternalStockMover[]>([]);
  const prevSectorData: Record<string, number> = {};
  const prevStockData: Record<string, number> = {};
  const requestAbort = { current: null as AbortController | null };

  const setActiveTab = (next: string | null) => {
    if (!isSectorTab(next)) return;
    setActiveTabState(next);
    writeTabToUrl(next);
  };

  return {
    data,
    setData,
    loading,
    setLoading,
    error,
    setError,
    market,
    setMarket,
    activeTab: activeTabState,
    setActiveTab,
    alerts,
    setAlerts,
    intervalMovers,
    setIntervalMovers,
    prevSectorData,
    prevStockData,
    requestAbort,
  };
}

function useSectorLoadData(state: SectorState) {
  const {
    requestAbort,
    setLoading,
    setError,
    setData,
    setAlerts,
    setIntervalMovers,
    prevSectorData,
    prevStockData,
  } = state;

  const loadData = async (mkt: string, isInitial = false, force = false): Promise<boolean> => {
    if (requestAbort.current) {
      // A manual refresh supersedes whatever is in flight; a background poll
      // yields to it instead of stacking a second upstream scan.
      if (!isInitial && !force) return false;
      requestAbort.current.abort();
    }
    const controller = new AbortController();
    requestAbort.current = controller;
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const res = await fetchSectorPerformance(mkt, controller.signal, force);
      if (controller.signal.aborted) return false;
      processSectorResponse(
        res,
        prevSectorData,
        prevStockData,
        (fn) => setAlerts(fn),
        (movers) => setIntervalMovers(movers),
      );
      setData(res);
      return true;
    } catch (err) {
      if (controller.signal.aborted) return false;
      setError(err instanceof Error ? err.message : "Failed to load sector data");
      return true;
    } finally {
      if (requestAbort.current === controller) {
        requestAbort.current = null;
        setLoading(false);
      }
    }
  };

  return loadData;
}

function useSectorPolling(
  state: SectorState,
  loadData: (mkt: string, isInitial?: boolean, force?: boolean) => Promise<boolean>,
) {
  const { activeTab, market, setLoading, requestAbort } = state;

  createEffect(() => {
    const currentTab = activeTab();
    const currentMarket = market();
    if (currentTab !== "dashboard") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let fastPollCount = 0;
    const liveTimeout = { current: null as ReturnType<typeof setTimeout> | null };

    const scheduleNextPoll = (delay: number) => {
      if (cancelled) return;
      liveTimeout.current = setTimeout(() => {
        if (cancelled) return;
        if (!isMarketOpenNow()) return;
        void loadData(currentMarket).then((completed) => {
          if (cancelled || !completed) return;
          fastPollCount += 1;
          scheduleNextPoll(fastPollCount < 2 ? 5000 : 60000);
        });
      }, delay);
    };

    void loadData(currentMarket, true).then((completed) => {
      if (!cancelled && completed) {
        scheduleNextPoll(5000);
      }
    });

    onCleanup(() => {
      cancelled = true;
      if (liveTimeout.current) clearTimeout(liveTimeout.current);
      requestAbort.current?.abort();
    });
  });
}

function useSectorData() {
  const state = useSectorState();
  const loadData = useSectorLoadData(state);
  useSectorPolling(state, loadData);
  return { ...state, loadData };
}

// src/hooks/useStoreSubscription.ts's useStoreSnapshot misses its createMemo
// import, so the snapshot is inlined here with the same semantics.
function useHolidayTick() {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const unsubscribe = subscribeToHolidays(() => setTick((n) => n + 1));
    onCleanup(unsubscribe);
  });
  return tick;
}

function SectorPageHeader(props: {
  market: "india" | "america";
  setMarket: (m: "india" | "america") => void;
  loading: boolean;
  onRefresh: () => void;
  showRefresh: boolean;
  activeTab: SectorTab;
  setActiveTab: (tab: string | null) => void;
}) {
  useHolidayTick();
  const marketOpen = () => isMarketOpenNow();
  return (
    <ToolbarRow
      gap={8}
      wrap={false}
      clip
      data-testid="sector-header"
      style={{ padding: "0 12px", "min-height": "36px", height: "36px", "border-bottom": "1px solid var(--color-fin-border)", "flex-shrink": "0" }}
    >
      <Text fw={700} className="text-[12px] whitespace-nowrap">
        Sector Dashboard
      </Text>
      <Text c="dimmed" className="hidden whitespace-nowrap text-[10px] xl:inline">
        Real-time sector performance and technical strength.
      </Text>
      <Show when={!marketOpen()}>
        <Text
          c="warning"
          fw={700}
          title="Showing the last available session snapshot"
          className="text-[9.5px] whitespace-nowrap tracking-[0.4px]"
        >
          MARKET CLOSED
        </Text>
      </Show>
      <Box className="mx-1 h-4 w-px shrink-0 bg-fin-border" />
      <CompactToggle
        testId="sector-market-selector"
        label="Market"
        value={props.market}
        options={[
          { value: "india", label: "India" },
          { value: "america", label: "US" },
        ]}
        onChange={(v) => props.setMarket(v as "india" | "america")}
      />
      <Tabs value={props.activeTab} onChange={props.setActiveTab} className="min-h-0 shrink-0">
        {/* The band already draws the section rule; a second bordered pill inside it is the nested-box anti-pattern. */}
        <Tabs.List
          className="gap-1"
          style={{ border: "0", background: "transparent", padding: "0", "min-height": "0" }}
        >
          <Tabs.Tab value="dashboard" className="text-[11px]" icon={<IconChartBar size={12} />}>
            Live Dashboard
          </Tabs.Tab>
          <Tabs.Tab value="correlation" className="text-[11px]" icon={<IconNetwork size={12} />}>
            Sector Correlation
          </Tabs.Tab>
          <Tabs.Tab value="rotation" className="text-[11px]" icon={<IconArrowsExchange size={12} />}>
            Rotation
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Box className="flex-1" />
      <Show when={props.showRefresh}>
        {/* @/ui Button reads `disabled`/`loading` once at construction, so the
            button is rebuilt whenever the loading flag flips. */}
        <Show when={props.loading} keyed>
          {() => (
            <Button
              variant="light"
              color="secondary"
              size="xs"
              leftSection={<IconRefresh size={12} />}
              onClick={props.onRefresh}
              loading={true}
              disabled={true}
              title={!marketOpen() ? "Market is closed" : undefined}
              data-testid="sector-refresh-btn"
            >
              Refresh
            </Button>
          )}
        </Show>
        <Show when={!props.loading}>
          <Button
            variant="light"
            color="secondary"
            size="xs"
            leftSection={<IconRefresh size={12} />}
            onClick={props.onRefresh}
            loading={false}
            disabled={!marketOpen()}
            title={!marketOpen() ? "Market is closed" : undefined}
            data-testid="sector-refresh-btn"
          >
            Refresh
          </Button>
        </Show>
      </Show>
    </ToolbarRow>
  );
}

function SectorContextBar(props: {
  data: SectorResponse | null;
  dashboardView: DashboardView;
  onDashboardViewChange: (view: DashboardView) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  heatmapMetric: string;
  onHeatmapMetricChange: (metric: string) => void;
  stockSectorFilter: string | null;
  onStockSectorFilterChange: (sector: string | null) => void;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
}) {
  const sectors = () => props.data?.sectors ?? [];
  const top = () => sectors()[0];
  const bottom = () => sectors()[sectors().length - 1];
  const advances = () => sectors().reduce((acc, s) => acc + s.advances, 0);
  const declines = () => sectors().reduce((acc, s) => acc + s.declines, 0);

  return (
    <ToolbarRow
      gap={8}
      wrap={false}
      clip
      data-testid="sector-context-bar"
      style={{ padding: "0 12px", "min-height": "28px", height: "28px", "border-bottom": "1px solid var(--color-fin-border)", "flex-shrink": "0" }}
    >
      <Show when={top() && bottom()}>
        <Box data-testid="sector-summary-strip" className="flex min-w-0 shrink items-center gap-3 overflow-hidden">
          <Box className="flex min-w-0 items-baseline gap-1">
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px] whitespace-nowrap">
              Top Sector
            </Text>
            <Text fw={700} c="success" truncate className="text-[11px]">
              {top()!.sector}
            </Text>
            <Text c="dimmed" className="text-[9.5px] font-mono tabular-nums whitespace-nowrap">
              Avg Change: {formatPercentage(top()!.avg_change)}
            </Text>
          </Box>
          <Box className="hidden items-baseline gap-[6px] lg:flex">
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px] whitespace-nowrap">
              Market Breadth
            </Text>
            <Text fw={700} c="success" className="text-[11px] font-mono tabular-nums">
              {advances()} UP
            </Text>
            <Text fw={700} c="error" className="text-[11px] font-mono tabular-nums">
              {declines()} DOWN
            </Text>
          </Box>
          <Box className="hidden min-w-0 items-baseline gap-1 xl:flex">
            <Text size="xs" c="dimmed" fw={700} tt="uppercase" className="text-[9px] tracking-[0.3px] whitespace-nowrap">
              Weakest Sector
            </Text>
            <Text fw={700} c="error" truncate className="text-[11px]">
              {bottom()!.sector}
            </Text>
            <Text c="dimmed" className="text-[9.5px] font-mono tabular-nums whitespace-nowrap">
              Avg Change: {formatPercentage(bottom()!.avg_change)}
            </Text>
          </Box>
        </Box>
      </Show>
      <Show when={props.dashboardView === "visual"}>
        <SectorHeatmapControls
          viewMode={props.viewMode}
          onViewModeChange={props.onViewModeChange}
          metric={props.heatmapMetric}
          onMetricChange={props.onHeatmapMetricChange}
          sectorFilter={props.stockSectorFilter}
          sectorOptions={props.sectorOptions}
          onSectorFilterChange={props.onStockSectorFilterChange}
          loading={props.heatmapLoading}
        />
      </Show>
      <Box className="flex-1" />
      <CompactToggle
        testId="sector-dashboard-view-toggle"
        label="Dashboard view"
        value={props.dashboardView}
        options={[
          { value: "table", label: "Table" },
          { value: "visual", label: "Visual" },
        ]}
        onChange={(v) => props.onDashboardViewChange(v as DashboardView)}
      />
    </ToolbarRow>
  );
}

function SectorTabContent(props: {
  activeTab: SectorTab;
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: "india" | "america";
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  loadData: (m: string, isInitial?: boolean, force?: boolean) => Promise<boolean>;
  viewMode: ViewMode;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  dashboardView: DashboardView;
}) {
  return (
    <Show
      when={props.activeTab !== "dashboard"}
      fallback={
        <Show when={!props.loading} fallback={<LoadingPanel />}>
          <Show when={!props.error} fallback={<ErrorPanel error={props.error ?? ""} onRetry={() => props.loadData(props.market)} />}>
            <Show when={props.data && props.data.sectors.length > 0} fallback={<EmptyPanel />}>
              <DashboardContent
                data={props.data!}
                alerts={props.alerts}
                intervalMovers={props.intervalMovers}
                viewMode={props.viewMode}
                heatmapStocks={props.heatmapStocks}
                heatmapMetric={props.heatmapMetric}
                dashboardView={props.dashboardView}
              />
            </Show>
          </Show>
        </Show>
      }
    >
      <Show when={props.activeTab === "rotation"} fallback={<SectorCorrelationTab />}>
        <RotationTab market={props.market} />
      </Show>
    </Show>
  );
}

export function SectorPage() {
  const state = useSectorData();

  const [viewMode, setViewMode] = createSignal<ViewMode>("sector");
  const [dashboardView, setDashboardView] = createSignal<DashboardView>(readDashboardView());
  const [heatmapMetric, setHeatmapMetric] = createSignal("change_pct");
  const [stockSectorFilter, setStockSectorFilter] = createSignal<string | null>(null);
  const [heatmapStocks, setHeatmapStocks] = createSignal<HeatmapStock[]>([]);
  const [heatmapLoading, setHeatmapLoading] = createSignal(false);

  createEffect(() => {
    const currentView = viewMode();
    const filter = stockSectorFilter();
    if (currentView !== "stock") return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    setHeatmapLoading(true);
    fetchHeatmapData(undefined, undefined, filter || undefined, 500, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return;
        setHeatmapStocks(res.stocks);
        setHeatmapLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHeatmapStocks([]);
        setHeatmapLoading(false);
      });
  });

  const sectorOptions = createMemo(() => {
    const unique = [...new Set(heatmapStocks().map((s) => s.sector).filter(Boolean))];
    return unique.map((s) => ({ value: s, label: s }));
  });

  return (
    <Box
      data-testid="sector-analysis-view"
      className="w-full h-full min-h-0 flex flex-col p-0 gap-0 overflow-hidden"
    >
      <SectorPageHeader
        market={state.market()}
        setMarket={state.setMarket}
        loading={state.loading()}
        onRefresh={() => state.loadData(state.market(), false, true)}
        showRefresh={state.activeTab() === "dashboard"}
        activeTab={state.activeTab()}
        setActiveTab={state.setActiveTab}
      />
      <Show when={state.activeTab() === "dashboard" && state.data()}>
        <SectorContextBar
          data={state.data()}
          dashboardView={dashboardView()}
          onDashboardViewChange={(view) => {
            setDashboardView(view);
            writeDashboardView(view);
          }}
          viewMode={viewMode()}
          onViewModeChange={setViewMode}
          heatmapMetric={heatmapMetric()}
          onHeatmapMetricChange={setHeatmapMetric}
          stockSectorFilter={stockSectorFilter()}
          onStockSectorFilterChange={setStockSectorFilter}
          sectorOptions={sectorOptions()}
          heatmapLoading={heatmapLoading()}
        />
      </Show>
      <Box className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <Box
          id="sector-page"
          className="flex-1 min-h-0 flex flex-col overflow-hidden w-full"
        >
          <Box flex={1} className="min-h-0 overflow-auto flex flex-col items-stretch">
            <SectorTabContent
              activeTab={state.activeTab()}
              data={state.data()}
              loading={state.loading()}
              error={state.error()}
              market={state.market()}
              alerts={state.alerts()}
              intervalMovers={state.intervalMovers()}
              loadData={state.loadData}
              viewMode={viewMode()}
              heatmapStocks={heatmapStocks()}
              heatmapMetric={heatmapMetric()}
              dashboardView={dashboardView()}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
