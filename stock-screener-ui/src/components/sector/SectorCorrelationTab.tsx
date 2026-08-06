import { useEffect, useMemo } from "react";
import {
  Box,
  Stack,
  Text,
  Title,
  Badge,
  Group,
  SegmentedControl,
  Paper,
  Table,
  ScrollArea,
  Loader,
  Tooltip,
  Button,
  SimpleGrid,
  useColorScheme,
} from "@/ui";
import { IconRefresh, IconClock } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import type { SectorCorrelationResponse } from "../../types/sector";
import {
  market as sectorMarket,
  lookbackDays,
  setMarket,
  setLookbackDays,
  isLoading as stateLoading,
  error as stateError,
  data as stateData,
  fetchCorrelationData,
  subscribe as subscribeToState,
} from "../../state/sectorCorrelation";
import { CompactPanel } from "../common/compact";
import { formatPercentage } from "../../utils/ui-helpers";
import { CorrelationHeatmap, SectorBetaChart, RotationTimeline } from "./SectorCorrelationCharts";

const LOOKBACK_OPTIONS = [
  { label: "5D", value: 5 },
  { label: "1M", value: 22 },
  { label: "3M", value: 66 },
  { label: "6M", value: 132 },
  { label: "1Y", value: 252 },
];

function CorrelationHeader({
  currentMarket,
  currentLookback,
  lastUpdated,
}: {
  currentMarket: string;
  currentLookback: number;
  lastUpdated?: string;
}) {
  const handleMarketChange = (v: string) => {
    setMarket(v as "india" | "america");
    void fetchCorrelationData();
  };
  const handleLookbackChange = (v: string) => {
    setLookbackDays(Number(v));
    void fetchCorrelationData();
  };
  const handleRefresh = () => {
    void fetchCorrelationData();
  };

  return (
    <Group justify="space-between">
      <Group gap="xs">
        <SegmentedControl
          data-testid="market-segment"
          value={currentMarket}
          onChange={handleMarketChange}
          data={[
            { label: "India", value: "india" },
            { label: "US", value: "america" },
          ]}
          size="sm"
        />
        <SegmentedControl
          data-testid="lookback-segment"
          value={String(currentLookback)}
          onChange={handleLookbackChange}
          data={LOOKBACK_OPTIONS.map((o) => ({ label: o.label, value: String(o.value) }))}
          size="sm"
        />
      </Group>
      <Group gap="xs">
        {lastUpdated && (
          <Group gap={4} display="inline-flex">
            <IconClock size={12} color="gray" />
            <Text size="sm" c="dimmed">
              {new Date(lastUpdated).toLocaleTimeString()}
            </Text>
          </Group>
        )}
        <Tooltip label="Refresh data">
          <Paper p="xs" withBorder style={{ cursor: "pointer" }} onClick={handleRefresh}>
            <IconRefresh size={14} />
          </Paper>
        </Tooltip>
      </Group>
    </Group>
  );
}

function RelativeStrengthTable({ sectors }: { sectors: SectorCorrelationResponse["sectors"] }) {
  return (
    <ScrollArea.Autosize mah={400} mx="auto">
      <Table striped highlightOnHover withTableBorder withColumnBorders size="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Rank</Table.Th>
            <Table.Th>Sector</Table.Th>
            <Table.Th ta="right">5D RS</Table.Th>
            <Table.Th ta="right">1M RS</Table.Th>
            <Table.Th ta="right">3M RS</Table.Th>
            <Table.Th ta="right">Beta</Table.Th>
            <Table.Th ta="right">1M Change</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sectors.map((s) => (
            <Table.Tr key={s.name}>
              <Table.Td>
                <Badge color={s.rank_current <= 3 ? "green" : "gray"} variant="light">
                  #{s.rank_current}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text fw={500}>{s.name}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text c={s.relative_strength_5d >= 0 ? "green" : "red"}>
                  {formatPercentage(s.relative_strength_5d / 100, 2, false)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text c={s.relative_strength_1m >= 0 ? "green" : "red"}>
                  {formatPercentage(s.relative_strength_1m / 100, 2, false)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text c={s.relative_strength_3m >= 0 ? "green" : "red"}>
                  {formatPercentage(s.relative_strength_3m / 100, 2, false)}
                </Text>
              </Table.Td>
              <Table.Td ta="right">
                <Text>{s.beta_vs_index.toFixed(2)}</Text>
              </Table.Td>
              <Table.Td ta="right">
                <Badge
                  color={s.rank_change_1m > 0 ? "green" : s.rank_change_1m < 0 ? "red" : "gray"}
                  variant="light"
                >
                  {s.rank_change_1m > 0 ? `+${s.rank_change_1m}` : s.rank_change_1m}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}

function LoadingState() {
  return (
    <CompactPanel
      title={
        <Group gap="xs">
          <Loader size="sm" />
          <Text fw={600} size="sm">
            Loading sector correlation...
          </Text>
        </Group>
      }
      description="Computing cross-sector relationships and relative strength."
      style={{ minHeight: 400 }}
    >
      <Box />
    </CompactPanel>
  );
}

function ErrorState({ error }: { error: string }) {
  const handleRefresh = () => {
    void fetchCorrelationData();
  };
  return (
    <CompactPanel
      title="Error"
      description={error}
      action={
        <Button variant="light" color="red" size="sm" onClick={handleRefresh}>
          Retry
        </Button>
      }
    >
      <Box />
    </CompactPanel>
  );
}

export function SectorCorrelationTab() {
  useStoreSubscription(subscribeToState);
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
  const data = stateData;
  const sortedSectors = useMemo(() => {
    if (!data?.sectors) return [];
    return [...data.sectors].sort((a, b) => a.rank_current - b.rank_current);
  }, [data]);

  useEffect(() => {
    if (!data && !stateLoading) void fetchCorrelationData();
  }, []);

  if (stateLoading && !data) return <LoadingState />;
  if (stateError) return <ErrorState error={stateError} />;
  if (!data || !data.sector_names || data.sector_names.length === 0) {
    return (
      <CompactPanel title="No data" description="No correlation data available.">
        <Box />
      </CompactPanel>
    );
  }
  const benchmark = sectorMarket === "india" ? "NIFTY 50" : "SPY";

  return (
    <Stack gap="sm">
      <CorrelationHeader
        currentMarket={sectorMarket}
        currentLookback={lookbackDays}
        lastUpdated={data.last_updated}
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="sm">
        <CompactPanel
          id="sector-correlation-heatmap"
          data-testid="sector-correlation-heatmap"
          padded={false}
          title={<Title order={4}>Cross-Sector Correlation</Title>}
          style={{ minHeight: 400 }}
        >
          <Box px="sm" pb="sm" style={{ minHeight: 300 }}>
            <CorrelationHeatmap
              matrix={data.correlation_matrix}
              symbols={data.sector_names}
              isDark={isDark}
            />
          </Box>
        </CompactPanel>
        <CompactPanel
          id="sector-beta-chart"
          data-testid="sector-beta-chart"
          padded={false}
          title={<Title order={4}>Sector Beta vs Benchmark</Title>}
          style={{ minHeight: 450 }}
        >
          <Box px="sm" pb="sm" style={{ height: 350 }}>
            <SectorBetaChart sectors={sortedSectors} benchmark={benchmark} isDark={isDark} />
          </Box>
        </CompactPanel>
      </SimpleGrid>
      <CompactPanel
        id="relative-strength-table"
        data-testid="relative-strength-table"
        padded={false}
        title={<Title order={4}>Relative Strength Rankings</Title>}
      >
        <RelativeStrengthTable sectors={sortedSectors} />
      </CompactPanel>
      <CompactPanel
        id="rotation-timeline"
        data-testid="rotation-timeline"
        padded={false}
        title={<Title order={4}>Sector Rotation (1-Month Rank Change)</Title>}
        style={{ minHeight: 500 }}
      >
        <Box px="sm" pb="sm" style={{ height: 450 }}>
          <RotationTimeline sectors={sortedSectors} isDark={isDark} />
        </Box>
      </CompactPanel>
    </Stack>
  );
}
