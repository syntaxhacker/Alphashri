import { useEffect, useMemo } from "react";
import { Box, Stack, Text } from "@/ui";
import { Button } from "@/ui";
import { Loader } from "@/ui";
import { Select } from "@/ui";
import { Chip } from "@/ui";
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
import { TanStackTable } from "../common/TanStackTable";
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
  const handleMarketChange = (v: string | null) => {
    if (v == null) return;
    setMarket(v as "india" | "america");
    void fetchCorrelationData();
  };
  const handleLookbackChange = (v: string | null) => {
    if (v == null) return;
    setLookbackDays(Number(v));
    void fetchCorrelationData();
  };
  const handleRefresh = () => {
    void fetchCorrelationData();
  };

  return (
    <Box data-testid="sector-correlation-header" className="flex items-center gap-1 flex-wrap px-1 py-0.5 min-h-[28px] border-b border-fin-border">
      <Text fw={700} className="text-[12px] whitespace-nowrap">
        Sector Correlation
      </Text>
      <Select
        size="xs"
        value={currentMarket}
        onChange={handleMarketChange}
        data={[{ value: "india", label: "India" }, { value: "america", label: "US" }]}
        data-testid="market-segment"
        className="h-[24px] text-[11px] min-w-[84px]"
      />
      <Select
        size="xs"
        value={String(currentLookback)}
        onChange={handleLookbackChange}
        data={LOOKBACK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
        data-testid="lookback-segment"
        className="h-[24px] text-[11px] min-w-[64px]"
      />
      <Box className="flex-1" />
      {lastUpdated && (
        <Box className="flex items-center gap-1">
          <IconClock size={12} className="text-fin-text-muted" />
          <Text size="xs" className="font-numeric tabular-nums">
            {new Date(lastUpdated).toLocaleTimeString()}
          </Text>
        </Box>
      )}
      <Box
        data-testid="sector-correlation-refresh"
        className="p-1 cursor-pointer flex items-center"
        onClick={handleRefresh}
      >
        <IconRefresh size={14} />
      </Box>
    </Box>
  );
}

function RelativeStrengthTable({ sectors }: { sectors: SectorCorrelationResponse["sectors"] }) {
  const columns = useMemo<ColumnDef<SectorCorrelationResponse["sectors"][number]>[]>(
    () => [
      {
        id: "rank",
        header: "Rank",
        accessorKey: "rank_current",
        size: 56,
        meta: { align: "center" },
        cell: (info) => {
          const rank = info.getValue<number>();
          return (
            <Chip size="xs" variant="outline" color={rank <= 3 ? "success" : "default"} className="h-[16px] text-[9.5px] px-1">
              #{rank}
            </Chip>
          );
        },
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "name",
        meta: { align: "left" },
        cell: (info) => (
          <Text className="font-semibold text-[10.5px] whitespace-nowrap">{info.getValue<string>()}</Text>
        ),
      },
      {
        id: "rs_5d",
        header: "5D RS",
        accessorKey: "relative_strength_5d",
        size: 80,
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "success" : "error"} className="text-[10.5px] font-numeric tabular-nums">
              {formatPercentage(val / 100, 2, false)}
            </Text>
          );
        },
      },
      {
        id: "rs_1m",
        header: "1M RS",
        accessorKey: "relative_strength_1m",
        size: 80,
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "success" : "error"} className="text-[10.5px] font-numeric tabular-nums">
              {formatPercentage(val / 100, 2, false)}
            </Text>
          );
        },
      },
      {
        id: "rs_3m",
        header: "3M RS",
        accessorKey: "relative_strength_3m",
        size: 80,
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Text c={val >= 0 ? "success" : "error"} className="text-[10.5px] font-numeric tabular-nums">
              {formatPercentage(val / 100, 2, false)}
            </Text>
          );
        },
      },
      {
        id: "beta",
        header: "Beta",
        accessorKey: "beta_vs_index",
        size: 64,
        meta: { align: "right" },
        cell: (info) => (
          <Text className="text-[10.5px] font-numeric tabular-nums">{info.getValue<number>().toFixed(2)}</Text>
        ),
      },
      {
        id: "rank_change",
        header: "1M Change",
        accessorKey: "rank_change_1m",
        size: 88,
        meta: { align: "center" },
        cell: (info) => {
          const change = info.getValue<number>();
          return (
            <Chip size="xs" variant="outline" color={change > 0 ? "success" : change < 0 ? "error" : "default"} className="h-[16px] text-[9.5px] px-1">
              {change > 0 ? `+${change}` : String(change)}
            </Chip>
          );
        },
      },
    ],
    [],
  );

  return (
    <TanStackTable
      data={sectors}
      columns={columns}
      enableSorting={false}
      dataTestId="relative-strength-table-inner"
      emptyMessage="No relative-strength rows"
      dense
      stickyHeader
      rowWindowSize={40}
    />
  );
}

function LoadingState() {
  return (
    <Box data-testid="sector-correlation-loading" className="flex items-center justify-center gap-2 flex-1 min-h-[200px]">
      <Loader size="xs" />
      <Text size="xs">Loading sector correlation…</Text>
    </Box>
  );
}

function ErrorState({ error }: { error: string }) {
  const handleRefresh = () => {
    void fetchCorrelationData();
  };
  return (
    <Box data-testid="sector-correlation-error" className="flex items-center gap-2 p-2">
      <Text size="xs" c="error">
        {error}
      </Text>
      <Button variant="outline" color="error" size="xs" onClick={handleRefresh} className="h-[22px] text-[10px]">
        Retry
      </Button>
    </Box>
  );
}

export function SectorCorrelationTab() {
  useStoreSubscription(subscribeToState);
  const isDark = typeof document !== "undefined" ? document.documentElement.getAttribute("data-dark") === "true" : false;
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
      <Box data-testid="sector-correlation-empty" className="flex items-center justify-center p-2">
        <Text size="xs" c="dimmed">
          No correlation data available.
        </Text>
      </Box>
    );
  }
  const benchmark = sectorMarket === "india" ? "NIFTY 50" : "SPY";

  return (
    <Stack spacing={0.5} className="p-1 w-full min-w-0">
      <CorrelationHeader currentMarket={sectorMarket} currentLookback={lookbackDays} lastUpdated={data.last_updated} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 w-full">
        <CompactPanel
          flush
          padded={false}
          id="sector-correlation-heatmap"
          testId="sector-correlation-heatmap"
          title={<Text className="text-[10px] font-bold">Cross-Sector Correlation</Text>}
          className="min-w-0"
        >
          <Box className="p-1 min-h-[280px] w-full">
            <CorrelationHeatmap matrix={data.correlation_matrix} symbols={data.sector_names} isDark={isDark} />
          </Box>
        </CompactPanel>
        <CompactPanel
          flush
          padded={false}
          id="sector-beta-chart"
          testId="sector-beta-chart"
          title={<Text className="text-[10px] font-bold">Sector Beta vs Benchmark</Text>}
          className="min-w-0"
        >
          <Box className="p-1 h-[320px] w-full flex">
            <SectorBetaChart sectors={sortedSectors} benchmark={benchmark} isDark={isDark} />
          </Box>
        </CompactPanel>
      </div>
      <CompactPanel
        flush
        padded={false}
        id="relative-strength-table"
        testId="relative-strength-table"
        title={<Text className="text-[10px] font-bold">Relative Strength Rankings</Text>}
        className="min-w-0"
      >
        <Box className="w-full min-w-0">
          <RelativeStrengthTable sectors={sortedSectors} />
        </Box>
      </CompactPanel>
      <CompactPanel
        flush
        padded={false}
        id="rotation-timeline"
        testId="rotation-timeline"
        title={<Text className="text-[10px] font-bold">Sector Rotation (1-Month Rank Change)</Text>}
        className="min-w-0"
      >
        <Box className="p-1 h-[400px] w-full flex">
          <RotationTimeline sectors={sortedSectors} isDark={isDark} />
        </Box>
      </CompactPanel>
    </Stack>
  );
}
