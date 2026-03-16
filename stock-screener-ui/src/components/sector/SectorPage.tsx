import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Group,
  Text,
  Button,
  Stack,
  Tabs,
  Card,
  SimpleGrid,
  Loader,
  Alert,
  SegmentedControl,
  Paper,
  Title,
  Badge,
  Table,
  ScrollArea,
} from "@mantine/core";
import {
  IconChartBar,
  IconBuildingFactory,
  IconRefresh,
  IconAlertCircle,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
} from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import { fetchSectorPerformance } from "../../api/sector";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8765";

interface SectorAlert {
  timestamp: string;
  sector: string;
  direction: "SURGING" | "DROPPING";
  delta: number;
}

interface InternalStockMover extends StockMover {
  prev_change: number;
  delta: number;
}

export function SectorPage() {
  const [data, setData] = useState<SectorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<"india" | "america">("india");
  const [activeTab, setActiveTab] = useState<string | null>("dashboard");
  const [alerts, setAlerts] = useState<SectorAlert[]>([]);
  const [intervalMovers, setIntervalMovers] = useState<InternalStockMover[]>([]);

  const prevSectorDataRef = useRef<Record<string, number>>({});
  const prevStockDataRef = useRef<Record<string, number>>({});

  const loadData = useCallback(async (selectedMarket: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchSectorPerformance(selectedMarket);

      // 1. Check for Sector Alerts
      const newAlerts: SectorAlert[] = [];
      (response.sectors ?? []).forEach((item: SectorItem) => {
        const prevChange = prevSectorDataRef.current[item.sector];
        if (prevChange !== undefined) {
          const delta = item.avg_change - prevChange;
          if (Math.abs(delta) >= 0.3) {
            newAlerts.push({
              timestamp: new Date().toLocaleTimeString(),
              sector: item.sector,
              direction: delta > 0 ? "SURGING" : "DROPPING",
              delta: delta,
            });
          }
        }
        prevSectorDataRef.current[item.sector] = item.avg_change;
      });

      if (newAlerts.length > 0) {
        setAlerts((prev) => [...newAlerts, ...prev].slice(0, 10));
      }

      // 2. Check for Interval Movers (Stock level)
      const newIntervalMovers: InternalStockMover[] = [];
      (response.top_stock_movers ?? []).forEach((item: StockMover) => {
        const prevChange = prevStockDataRef.current[item.symbol];
        if (prevChange !== undefined) {
          const delta = item.change - prevChange;
          if (Math.abs(delta) >= 0.3) {
            newIntervalMovers.push({
              ...item,
              prev_change: prevChange,
              delta: delta,
            });
          }
        }
        prevStockDataRef.current[item.symbol] = item.change;
      });

      if (newIntervalMovers.length > 0) {
        newIntervalMovers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
        setIntervalMovers(newIntervalMovers.slice(0, 10));
      }

      setData(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sector data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    prevSectorDataRef.current = {};
    prevStockDataRef.current = {};
    setAlerts([]);
    setIntervalMovers([]);
    loadData(market);
    const interval = setInterval(() => loadData(market), 60000);
    return () => clearInterval(interval);
  }, [market, loadData]);

  const renderDashboard = () => {
    if (loading && !data) {
      return (
        <Stack align="center" justify="center" h={400}>
          <Loader size="lg" />
          <Text c="dimmed">Fetching sector performance...</Text>
        </Stack>
      );
    }

    if (error) {
      return (
        <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red">
          {error}
          <Button variant="light" color="red" size="sm" mt="md" onClick={() => loadData(market)}>
            Retry
          </Button>
        </Alert>
      );
    }

    if (!data || data.sectors.length === 0) {
      return (
        <Paper p="xl" withBorder style={{ textAlign: "center" }}>
          <Text c="dimmed">No sector data available for this market.</Text>
        </Paper>
      );
    }

    const topSector = data.sectors[0];
    const bottomSector = data.sectors[data.sectors.length - 1];

    return (
      <Stack gap="md" h="100%">
        {/* Summary Cards */}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          <Card
            withBorder
            padding="sm"
            radius="md"
            id="sector-top-card"
            data-testid="sector-top-card"
          >
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Top Sector
            </Text>
            <Text size="lg" fw={700} c="green">
              {topSector.sector}
            </Text>
            <Text size="sm" fw={500}>
              Avg Change: +{topSector.avg_change.toFixed(2)}%
            </Text>
          </Card>

          <Card
            withBorder
            padding="sm"
            radius="md"
            id="sector-breadth-card"
            data-testid="sector-breadth-card"
          >
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Market Breadth
            </Text>
            <Group gap="xs" mt={4}>
              <Badge color="green" variant="light">
                {data.sectors.reduce((acc, s) => acc + s.advances, 0)} UP
              </Badge>
              <Badge color="red" variant="light">
                {data.sectors.reduce((acc, s) => acc + s.declines, 0)} DOWN
              </Badge>
            </Group>
          </Card>

          <Card
            withBorder
            padding="sm"
            radius="md"
            id="sector-weakest-card"
            data-testid="sector-weakest-card"
          >
            <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
              Weakest Sector
            </Text>
            <Text size="lg" fw={700} c="red">
              {bottomSector.sector}
            </Text>
            <Text size="sm" fw={500}>
              Avg Change: {bottomSector.avg_change.toFixed(2)}%
            </Text>
          </Card>
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" style={{ flex: 1, minHeight: 0 }}>
          {/* Sector Table */}
          <Box
            style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
            id="sector-table-container"
            data-testid="sector-table-container"
          >
            <Group justify="space-between" mb="xs">
              <Title order={4}>📊 Sector Performance</Title>
              {data.last_updated && (
                <Group gap={4}>
                  <IconClock size={12} color="gray" />
                  <Text size="sm" c="dimmed">
                    {new Date(data.last_updated).toLocaleTimeString()}
                  </Text>
                </Group>
              )}
            </Group>
            <Box flex={1} style={{ minHeight: 0 }}>
              <SectorTable sectors={data.sectors} />
            </Box>
          </Box>

          {/* Alerts & Movers */}
          <Stack gap="md" style={{ overflow: "hidden" }}>
            <Card
              withBorder
              padding="sm"
              radius="md"
              id="sector-alerts-card"
              data-testid="sector-alerts-card"
              style={{ flex: "1 1 50%", display: "flex", flexDirection: "column" }}
            >
              <Group justify="space-between" mb="xs">
                <Title order={4}>🔔 Real-time Alerts</Title>
                <IconBellRinging size={18} color="orange" />
              </Group>
              <ScrollArea flex={1}>
                {alerts.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="xl">
                    Waiting for major movements...
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {alerts.map((alert, i) => (
                      <Paper
                        key={i}
                        p="xs"
                        withBorder
                        bg={
                          alert.direction === "SURGING"
                            ? "rgba(64, 192, 87, 0.05)"
                            : "rgba(250, 82, 82, 0.05)"
                        }
                      >
                        <Group justify="space-between">
                          <Text size="sm" fw={700}>
                            [{alert.timestamp}] {alert.sector}
                          </Text>
                          <Badge color={alert.direction === "SURGING" ? "green" : "red"} size="sm">
                            {alert.direction} ({alert.delta > 0 ? "+" : ""}
                            {alert.delta.toFixed(2)}%)
                          </Badge>
                        </Group>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </ScrollArea>
            </Card>

            <Card
              withBorder
              padding="sm"
              radius="md"
              id="sector-interval-movers-card"
              data-testid="sector-interval-movers-card"
              style={{ flex: "1 1 50%", display: "flex", flexDirection: "column" }}
            >
              <Group justify="space-between" mb="xs">
                <Title order={4}>⏱ Interval Movers</Title>
                <IconTrendingUp size={18} color="blue" />
              </Group>
              <ScrollArea flex={1}>
                {intervalMovers.length === 0 ? (
                  <Text size="sm" c="dimmed" ta="center" py="xl">
                    Collecting baseline for interval moves...
                  </Text>
                ) : (
                  <Table striped highlightOnHover size="sm">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Stock</Table.Th>
                        <Table.Th align="right">Prev</Table.Th>
                        <Table.Th align="right">Now</Table.Th>
                        <Table.Th align="right">Δ</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {intervalMovers.map((mover) => (
                        <Table.Tr key={mover.symbol}>
                          <Table.Td fw={600}>{mover.symbol}</Table.Td>
                          <Table.Td align="right">{mover.prev_change.toFixed(2)}%</Table.Td>
                          <Table.Td align="right">{mover.change.toFixed(2)}%</Table.Td>
                          <Table.Td align="right">
                            <Text c={mover.delta >= 0 ? "green" : "red"} fw={700}>
                              {mover.delta > 0 ? "+" : ""}
                              {mover.delta.toFixed(2)}%
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </ScrollArea>
            </Card>
          </Stack>
        </SimpleGrid>
      </Stack>
    );
  };

  return (
    <Box
      h="100%"
      id="sector-page"
      className="sector-page"
      style={{ display: "flex", flexDirection: "column" }}
      data-testid="sector-analysis-view"
    >
      <Box
        flex="0 0 auto"
        style={{ padding: "var(--mantine-spacing-md)" }}
        className="sector-analysis-header"
      >
        <Stack gap="md">
          <Group justify="space-between" align="flex-start">
            <div>
              <Title order={2}>Sector Dashboard</Title>
              <Text size="sm" c="dimmed">
                Real-time sector performance and technical strength
              </Text>
            </div>
            <Group gap="xs">
              <SegmentedControl
                value={market}
                onChange={(v) => setMarket(v as any)}
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
                onClick={() => loadData(market)}
                loading={loading}
                data-testid="sector-refresh-btn"
              >
                Refresh
              </Button>
            </Group>
          </Group>

          <Tabs value={activeTab} onChange={setActiveTab}>
            <Tabs.List>
              <Tabs.Tab value="dashboard" leftSection={<IconChartBar size={14} />}>
                Live Dashboard
              </Tabs.Tab>
              <Tabs.Tab value="historical" leftSection={<IconBuildingFactory size={14} />}>
                Historical Cycles
              </Tabs.Tab>
            </Tabs.List>
          </Tabs>
        </Stack>
      </Box>

      <Box
        flex={1}
        style={{ minHeight: 0, padding: "0 var(--mantine-spacing-md) var(--mantine-spacing-md)" }}
      >
        {activeTab === "dashboard" ? (
          renderDashboard()
        ) : (
          <Box
            h="100%"
            className="sector-analysis-frame-wrap"
            data-testid="sector-analysis-frame"
            style={{
              borderRadius: "var(--mantine-radius-default)",
              overflow: "hidden",
              border: "1px solid var(--mantine-color-dark-4)",
            }}
          >
            <iframe
              src={`${API_BASE}/sector/dashboard-modular.html`}
              title="Sector Rotation Dashboard"
              className="sector-analysis-frame"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                display: "block",
              }}
              data-testid="sector-iframe"
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
