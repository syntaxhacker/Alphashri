import { useState, useEffect, useCallback, useRef } from "react";
import {
  Box,
  Group,
  Text,
  Button,
  Stack,
  Tabs,
  SimpleGrid,
  Loader,
  SegmentedControl,
  Paper,
  Title,
  Badge,
  Table,
  ScrollArea,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import {
  IconChartBar,
  IconBuildingFactory,
  IconRefresh,
  IconBellRinging,
  IconTrendingUp,
  IconClock,
} from "@tabler/icons-react";
import { SectorTable } from "./SectorTable";
import { fetchSectorPerformance } from "../../api/sector";
import type { SectorResponse, SectorItem, StockMover } from "../../types/sector";
import { CompactPage, CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";

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

function SectorTreemap({ sectors }: { sectors: SectorItem[] }) {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const treemapData = [...sectors]
    .map((sector) => ({
      name: sector.sector,
      value: Math.max(Math.abs(sector.avg_change), 0.01),
      avgChange: sector.avg_change,
      stockCount: sector.stock_count,
      advances: sector.advances,
      declines: sector.declines,
      avgRsi: sector.avg_rsi,
      avgAdx: sector.avg_adx,
      topMovers: sector.top_movers,
      itemStyle: {
        color:
          sector.avg_change >= 2.5
            ? "#166534"
            : sector.avg_change >= 1.25
              ? "#1f7a4a"
              : sector.avg_change >= 0.25
                ? "#2b5f46"
                : sector.avg_change <= -2.5
                  ? "#7f1d1d"
                  : sector.avg_change <= -1.25
                    ? "#991b1b"
                    : sector.avg_change <= -0.25
                      ? "#7a2e2e"
                      : "#2a3441",
        gapWidth: 0,
      },
    }))
    .sort((a, b) => Math.abs(b.avgChange) - Math.abs(a.avgChange) || b.value - a.value);

  const tileSpans = treemapData.map((_, index) => {
    if (index === 0) return { col: "span 2", row: "span 2", minHeight: 212 };
    if (index < 3) return { col: "span 1", row: "span 1", minHeight: 102 };
    if (index < 7) return { col: "span 1", row: "span 1", minHeight: 84 };
    return { col: "span 1", row: "span 1", minHeight: 72 };
  });

  return (
    <Box
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gridAutoRows: "minmax(72px, auto)",
        gap: "8px",
        height: "100%",
        minHeight: 320,
      }}
    >
      {treemapData.map((sector, index) => {
        const span = tileSpans[index];
        const changePrefix = sector.avgChange >= 0 ? "+" : "";

        return (
          <Box
            key={sector.name}
            style={{
              gridColumn: span.col,
              gridRow: span.row,
              minHeight: span.minHeight,
              background: sector.itemStyle.color,
              color: "#f8fafc",
              padding: index === 0 ? "16px" : "12px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxShadow: isDark
                ? "inset 0 1px 0 rgba(255,255,255,0.04)"
                : "inset 0 1px 0 rgba(255,255,255,0.16)",
            }}
          >
            <Stack gap={4}>
              <Text fw={800} size={index === 0 ? "lg" : "sm"} lh={1.1}>
                {sector.name}
              </Text>
              <Text fw={700} size={index === 0 ? "md" : "sm"} opacity={0.95}>
                {changePrefix}
                {sector.avgChange.toFixed(2)}%
              </Text>
            </Stack>

            <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap">
              <Stack gap={2}>
                <Text size="xs" opacity={0.75}>
                  Stocks {sector.stockCount}
                </Text>
                <Text size="xs" opacity={0.75}>
                  {sector.advances} / {sector.declines}
                </Text>
              </Stack>
              {index < 6 ? (
                <Badge
                  size="xs"
                  variant="filled"
                  color="dark"
                  styles={{
                    root: {
                      backgroundColor: "rgba(15, 23, 42, 0.28)",
                      color: "#f8fafc",
                    },
                  }}
                >
                  #{index + 1}
                </Badge>
              ) : null}
            </Group>
          </Box>
        );
      })}
    </Box>
  );
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
  const liveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Clear any existing timers
    if (liveTimeoutRef.current) {
      clearTimeout(liveTimeoutRef.current);
    }

    // Rapid refresh every 1 second for 5 seconds
    let liveCount = 0;
    const liveInterval = setInterval(() => {
      liveCount++;
      loadData(market);
      if (liveCount >= 5) {
        clearInterval(liveInterval);
        liveTimeoutRef.current = null;
      }
    }, 1000);

    // Normal refresh every 60 seconds after live period
    const interval = setInterval(() => loadData(market), 60000);
    return () => {
      clearInterval(interval);
      clearInterval(liveInterval);
      if (liveTimeoutRef.current) {
        clearTimeout(liveTimeoutRef.current);
      }
    };
  }, [market, loadData]);

  const renderDashboard = () => {
    if (loading && !data) {
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
        />
      );
    }

    if (error) {
      return (
        <CompactPanel
          title="Error"
          description={error}
          action={
            <Button variant="light" color="red" size="sm" onClick={() => loadData(market)}>
              Retry
            </Button>
          }
        />
      );
    }

    if (!data || data.sectors.length === 0) {
      return (
        <CompactPanel
          title="No sector data"
          description="No sector data available for this market."
        />
      );
    }

    const topSector = data.sectors[0];
    const bottomSector = data.sectors[data.sectors.length - 1];

    return (
      <Stack gap="sm">
        {/* Summary Cards */}
        <CompactStatGrid>
          <CompactStat
            label="Top Sector"
            value={topSector.sector}
            tone="var(--mantine-color-green-6)"
            hint={`Avg Change: +${topSector.avg_change.toFixed(2)}%`}
          />
          <CompactStat
            label="Market Breadth"
            value={
              <Group gap="xs">
                <Badge color="green" variant="light">
                  {data.sectors.reduce((acc, s) => acc + s.advances, 0)} UP
                </Badge>
                <Badge color="red" variant="light">
                  {data.sectors.reduce((acc, s) => acc + s.declines, 0)} DOWN
                </Badge>
              </Group>
            }
          />
          <CompactStat
            label="Weakest Sector"
            value={bottomSector.sector}
            tone="var(--mantine-color-red-6)"
            hint={`Avg Change: ${bottomSector.avg_change.toFixed(2)}%`}
          />
        </CompactStatGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
          <CompactPanel
            style={{ overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}
            id="sector-treemap-container"
            data-testid="sector-treemap-container"
            padded={false}
            title={
              <Group justify="space-between" mb="xs">
                <Title order={4}>Live Sector Map</Title>
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
            <Box px="sm" pb="sm" style={{ minHeight: 0, flex: 1 }}>
              <SectorTreemap sectors={data.sectors} />
            </Box>
          </CompactPanel>

          <CompactPanel
            style={{ overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}
            id="sector-table-container"
            data-testid="sector-table-container"
            padded={false}
            title={<Title order={4}>Sector Performance</Title>}
          >
            <Box px="sm" pb="sm" flex={1} style={{ minHeight: 0 }}>
              <SectorTable sectors={data.sectors} />
            </Box>
          </CompactPanel>

          {/* Alerts & Movers */}
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
            </CompactPanel>
          </Stack>
        </SimpleGrid>
      </Stack>
    );
  };

  return (
    <CompactPage
      title="Sector Dashboard"
      description="Real-time sector performance and technical strength."
      actions={
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
      }
    >
      <Box
        id="sector-page"
        className="sector-page"
        flex={1}
        style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        data-testid="sector-analysis-view"
      >
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

        <Box
          flex={1}
          style={{
            minHeight: 0,
            padding: "0 var(--mantine-spacing-md) var(--mantine-spacing-md)",
            overflow: "auto",
          }}
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
                overflow: "auto",
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
    </CompactPage>
  );
}
