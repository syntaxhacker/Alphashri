import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  Box,
  Group,
  Text,
  Button,
  Stack,
  Tabs,
  SimpleGrid,
  Loader,
  Paper,
  SegmentedControl,
  Title,
  Badge,
  ScrollArea,
} from "@/ui";
import {
  IconChartBar,
  IconBuildingFactory,
  IconRefresh,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
  IconNetwork,
} from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import { IntervalMoversTable } from "./IntervalMoversTable";
import { SectorCorrelationTab } from "./SectorCorrelationTab";
import { fetchSectorPerformance } from "../../api/sector";
import { fetchHeatmapData } from "../../api/heatmap";
import type { HeatmapStock } from "../../api/heatmap";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { subscribeToHolidays, isMarketClosedToday } from "../../state/holidays";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { formatPercentage } from "../../utils/ui-helpers";
import { detectSectorAlerts, detectIntervalMovers } from "./SectorHelpers";
import type { SectorAlert, InternalStockMover } from "./SectorHelpers";
import { SectorHeatmapView } from "./SectorHeatmapView";
import type { ViewMode } from "./SectorHeatmapView";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

function AlertsList({ alerts }: { alerts: SectorAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        Waiting for major movements...
      </Text>
    );
  }

  return (
    <Stack gap="xs">
      {alerts.map((alert, i) => (
        <Paper
          key={i}
          p="xs"
          withBorder
          bg={alert.direction === "SURGING" ? "rgba(64, 192, 87, 0.05)" : "rgba(250, 82, 82, 0.05)"}
        >
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              [{alert.timestamp}] {alert.sector}
            </Text>
            <Badge color={alert.direction === "SURGING" ? "green" : "red"} size="sm">
              {alert.direction} ({formatPercentage(alert.delta, 2, false)})
            </Badge>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

function AlertsAndMovers({
  alerts,
  intervalMovers,
}: {
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
}) {
  return (
    <Stack gap="md" style={{ overflow: "hidden" }}>
      <CompactPanel
        id="sector-alerts-card"
        data-testid="sector-alerts-card"
        style={{ flex: "1 1 50%", display: "flex", flexDirection: "column" }}
        title={
          <Group justify="space-between" mb="xs">
            <Title order={4}>Real-time Alerts</Title>
            <IconBellRinging size={18} color="orange" />
          </Group>
        }
      >
        <ScrollArea flex={1}>
          <AlertsList alerts={alerts} />
        </ScrollArea>
      </CompactPanel>

      <CompactPanel
        id="sector-interval-movers-card"
        data-testid="sector-interval-movers-card"
        style={{ flex: "1 1 50%", display: "flex", flexDirection: "column" }}
        title={
          <Group justify="space-between" mb="xs">
            <Title order={4}>Interval Movers</Title>
            <IconTrendingUp size={18} color="blue" />
          </Group>
        }
      >
        <ScrollArea flex={1}>
          <IntervalMoversTable movers={intervalMovers} />
        </ScrollArea>
      </CompactPanel>
    </Stack>
  );
}

function LoadingPanel() {
  return (
    <CompactPanel
      title={
        <Group gap="xs" wrap="nowrap">
          <Loader size="sm" />
          <Text fw={600} size="sm">
            Fetching sector performance
          </Text>
        </Group>
      }
      description="Loading live sector breadth and movers."
      style={{ minHeight: 400 }}
    >
      <Box flex={1} style={{ minHeight: 0 }} />
    </CompactPanel>
  );
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <CompactPanel
      title="Error"
      description={error}
      action={
        <Button variant="light" color="red" size="sm" onClick={onRetry}>
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
}) {
  const bottomSector = data.sectors[data.sectors.length - 1];
  const totalAdvances = data.sectors.reduce((acc, s) => acc + s.advances, 0);
  const totalDeclines = data.sectors.reduce((acc, s) => acc + s.declines, 0);

  return (
    <Stack gap="sm">
      <CompactStatGrid>
        <CompactStat
          label="Top Sector"
          value={data.sectors[0].sector}
          tone="var(--mantine-color-green-6)"
          hint={`Avg Change: ${formatPercentage(data.sectors[0].avg_change)}`}
        />
        <CompactStat
          label="Market Breadth"
          value={
            <Group gap="xs">
              <Badge color="green" variant="light">
                {totalAdvances} UP
              </Badge>
              <Badge color="red" variant="light">
                {totalDeclines} DOWN
              </Badge>
            </Group>
          }
        />
        <CompactStat
          label="Weakest Sector"
          value={bottomSector.sector}
          tone="var(--mantine-color-red-6)"
          hint={`Avg Change: ${formatPercentage(bottomSector.avg_change)}`}
        />
      </CompactStatGrid>

      <CompactPanel
        id="sector-heatmap-panel"
        data-testid="sector-heatmap-panel"
        padded={false}
        title={
          <Group justify="space-between" mb="xs">
            <Title order={4}>Market Heatmap</Title>
            {data.last_updated && (
              <Group gap={4}>
                <IconClock size={12} color="gray" />
                <Text size="sm" c="dimmed">
                  {new Date(data.last_updated).toLocaleTimeString()}
                </Text>
              </Group>
            )}
          </Group>
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

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <CompactPanel
          id="sector-table-container"
          data-testid="sector-table-container"
          padded={false}
          title={<Title order={4}>Sector Performance</Title>}
          scrollable
        >
          <Box px="sm" pb="sm" flex={1} style={{ minHeight: 0 }}>
            <SectorTable sectors={data.sectors} />
          </Box>
        </CompactPanel>

        <AlertsAndMovers alerts={alerts} intervalMovers={intervalMovers} />
      </SimpleGrid>
    </Stack>
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
  activeTab: string | null;
  setActiveTab: Dispatch<SetStateAction<string | null>>;
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
  const [activeTab, setActiveTab] = useState<string | null>("dashboard");
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = useState<InternalStockMover[]>([]);
  const prevSectorDataRef = useRef<Record<string, number>>({});
  const prevStockDataRef = useRef<Record<string, number>>({});
  const requestAbortRef = useRef<AbortController | null>(null);

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
    async (mkt: string, isInitial = false): Promise<boolean> => {
      if (requestAbortRef.current) {
        if (!isInitial) return false;
        requestAbortRef.current.abort();
      }
      const controller = new AbortController();
      requestAbortRef.current = controller;
      if (isInitial) setLoading(true);
      setError(null);
      try {
        const res = await fetchSectorPerformance(mkt, controller.signal);
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
  loadData: (mkt: string, isInitial?: boolean) => Promise<boolean>,
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
        if (isMarketClosedToday()) return;
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
}: {
  market: "india" | "america";
  setMarket: (m: "india" | "america") => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Box className="sector-analysis-header">
      <Stack gap={2}>
        <Title order={2} size="h4">
          Sector Dashboard
        </Title>
        <Text size="sm" c="dimmed">
          Real-time sector performance and technical strength.
        </Text>
      </Stack>
      <Group gap="xs">
        <SegmentedControl
          value={market}
          onChange={(v) => setMarket(v as "india" | "america")}
          data={[
            { label: "India", value: "india" },
            { label: "US", value: "america" },
          ]}
          size="sm"
          data-testid="sector-market-selector"
        />
        <Button
          variant="light"
          size="sm"
          leftSection={<IconRefresh size={14} />}
          onClick={onRefresh}
          loading={loading}
          data-testid="sector-refresh-btn"
        >
          Refresh
        </Button>
      </Group>
    </Box>
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
}: {
  activeTab: string | null;
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: string;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  loadData: (m: string, isInitial?: boolean) => Promise<boolean>;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  heatmapStocks: HeatmapStock[];
  heatmapMetric: string;
  onHeatmapMetricChange: (metric: string) => void;
  stockSectorFilter: string | null;
  onStockSectorFilterChange: (sector: string | null) => void;
  sectorOptions: { value: string; label: string }[];
  heatmapLoading: boolean;
}) {
  if (activeTab === "correlation") {
    return <SectorCorrelationTab />;
  }
  if (activeTab !== "dashboard") {
    return (
      <Box
        h="100%"
        className="sector-analysis-frame-wrap"
        data-testid="sector-analysis-frame"
        style={{
          borderRadius: "var(--mantine-radius-default)",
          overflow: "auto",
          border: "1px solid var(--mantine-color-dark-4)",
        }}
      >
        <iframe
          src={`${API_BASE}/sector/dashboard-modular.html`}
          title="Sector Rotation Dashboard"
          className="sector-analysis-frame"
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          data-testid="sector-iframe"
        />
      </Box>
    );
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
    />
  );
}

export function SectorPage() {
  useStoreSubscription(subscribeToHolidays);
  const state = useSectorData();

  const [viewMode, setViewMode] = useState<ViewMode>("sector");
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
    <Stack
      gap="sm"
      style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}
      data-testid="sector-analysis-view"
    >
      <SectorPageHeader
        market={state.market}
        setMarket={state.setMarket}
        loading={state.loading}
        onRefresh={() => state.loadData(state.market)}
      />
      <Box
        id="sector-page"
        className="sector-page"
        flex={1}
        style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Tabs value={state.activeTab} onChange={state.setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="dashboard" leftSection={<IconChartBar size={14} />}>
              Live Dashboard
            </Tabs.Tab>
            <Tabs.Tab value="correlation" leftSection={<IconNetwork size={14} />}>
              Sector Correlation
            </Tabs.Tab>
            <Tabs.Tab value="historical" leftSection={<IconBuildingFactory size={14} />}>
              Historical Cycles
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Box
          flex={1}
          style={{
            minHeight: 0,
            padding: "0 var(--mantine-spacing-md) var(--mantine-spacing-md)",
            overflow: "auto",
          }}
        >
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
          />
        </Box>
      </Box>
    </Stack>
  );
}
