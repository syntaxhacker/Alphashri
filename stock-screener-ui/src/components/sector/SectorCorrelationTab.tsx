import { useEffect, useMemo } from "react";
import { Box, Stack, Text, Title, Badge, Group, SegmentedControl, ScrollArea, Loader, Tooltip, Button, SimpleGrid, useColorScheme } from "@/ui";
import { IconRefresh, IconClock } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
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
import { TanStackTable } from "../common/TanStackTable";
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
    <Group justify="space-between" style={{ minHeight: 48 }}>
      <Group gap={1}>
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
      <Group gap={1}>
        {lastUpdated && (
          <Group gap={4} display="inline-flex">
            <IconClock size={12} color="gray" />
            <Text size="sm" c="dimmed">
              {new Date(lastUpdated).toLocaleTimeString()}
            </Text>
          </Group>
        )}
        <Tooltip label="Refresh data">
          <Box sx={{ p: 1, cursor: "pointer", display: "inline-flex" }} onClick={handleRefresh}>
            <IconRefresh size={14} />
          </Box>
        </Tooltip>
      </Group>
    </Group>
  );
}

function RelativeStrengthTable({ sectors }: { sectors: SectorCorrelationResponse["sectors"] }) {
  const columns = useMemo<ColumnDef<SectorCorrelationResponse["sectors"][number]>[]>(
    () => [
      {
        id: "rank",
        header: "Rank",
        accessorKey: "rank_current",
        cell: (info) => {
          const rank = info.getValue<number>();
          return (
            <Badge size="sm" color={rank <= 3 ? "green" : "gray"} variant="light">
              #{rank}
            </Badge>
          );
        },
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "name",
        cell: (info) => <Text fw={500}>{info.getValue<string>()}</Text>,
      },
      {
        id: "rs_5d",
        header: "5D RS",
        accessorKey: "relative_strength_5d",
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "green" : "red"}>{formatPercentage(val / 100, 2, false)}</Text>
          );
        },
      },
      {
        id: "rs_1m",
        header: "1M RS",
        accessorKey: "relative_strength_1m",
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "green" : "red"}>{formatPercentage(val / 100, 2, false)}</Text>
          );
        },
      },
      {
        id: "rs_3m",
        header: "3M RS",
        accessorKey: "relative_strength_3m",
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "green" : "red"}>{formatPercentage(val / 100, 2, false)}</Text>
          );
        },
      },
      {
        id: "beta",
        header: "Beta",
        accessorKey: "beta_vs_index",
        meta: { align: "right" },
        cell: (info) => <Text>{info.getValue<number>().toFixed(2)}</Text>,
      },
      {
        id: "rank_change",
        header: "1M Change",
        accessorKey: "rank_change_1m",
        meta: { align: "right" },
        cell: (info) => {
          const change = info.getValue<number>();
          return (
            <Badge
              size="sm"
              color={change > 0 ? "green" : change < 0 ? "red" : "gray"}
              variant="light"
            >
              {change > 0 ? `+${change}` : change}
            </Badge>
          );
        },
      },
    ],
    [],
  );

  return (
    <ScrollArea.Autosize mah={400} mx="auto">
      <TanStackTable
        data={sectors}
        columns={columns}
        enableSorting={false}
      />
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
