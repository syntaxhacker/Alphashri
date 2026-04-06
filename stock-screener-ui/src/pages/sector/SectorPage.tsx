import {
  Box,
  Group,
  Text,
  Button,
  Stack,
  Tabs,
  Loader,
  SegmentedControl,
  Title,
} from "@mantine/core";
import { IconChartBar, IconBuildingFactory, IconRefresh } from "@tabler/icons-react";
import type { SectorResponse } from "../../types/sector";
import { CompactPanel } from "../../components/common/compact";
import { useSectorData } from "../../components/sector/useSectorData";
import { DashboardContent } from "../../components/sector/SectorDashboardContent";
import type { SectorAlert, InternalStockMover } from "../../components/sector/sectorUtils";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

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
      style={{ minHeight: 400 }}
    >
      <Text size="sm" c="dimmed">
        Loading live sector breadth and movers.
      </Text>
    </CompactPanel>
  );
}

function ErrorPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <CompactPanel
      title="Error"
      action={
        <Button variant="light" color="red" size="sm" onClick={onRetry} data-testid="sector-retry-btn">
          Retry
        </Button>
      }
    >
      <Text size="sm" c="dimmed">
        {error}
      </Text>
    </CompactPanel>
  );
}

function EmptyPanel() {
  return (
    <CompactPanel title="No sector data">
      <Text size="sm" c="dimmed">
        No sector data available for this market.
      </Text>
    </CompactPanel>
  );
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
}: {
  activeTab: string | null;
  data: SectorResponse | null;
  loading: boolean;
  error: string | null;
  market: string;
  alerts: SectorAlert[];
  intervalMovers: InternalStockMover[];
  loadData: (m: string) => Promise<void>;
}) {
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
  return <DashboardContent data={data} alerts={alerts} intervalMovers={intervalMovers} />;
}

export function SectorPage() {
  const state = useSectorData();
  return (
    <Stack
      gap="sm"
      style={{ height: "100%", overflow: "hidden" }}
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
            <Tabs.Tab value="dashboard" leftSection={<IconChartBar size={14} />} data-testid="sector-tab-dashboard">
              Live Dashboard
            </Tabs.Tab>
            <Tabs.Tab value="historical" leftSection={<IconBuildingFactory size={14} />} data-testid="sector-tab-historical">
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
          />
        </Box>
      </Box>
    </Stack>
  );
}
