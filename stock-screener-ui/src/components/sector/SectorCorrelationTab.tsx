import { useEffect, useMemo } from "react";
import { Box, Stack, Text } from "@/ui";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
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

/** Dense control row shared by the header strip (8pt grid → 4px gaps). */
const HEADER_ROW_SX = {
  display: "flex",
  alignItems: "center",
  gap: 0.5,
  flexWrap: "wrap",
  px: 0.5,
  py: 0.25,
  minHeight: 28,
} as const;

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
    <Box data-testid="sector-correlation-header" sx={{ ...HEADER_ROW_SX, borderBottom: "1px solid", borderColor: "divider" }}>
      <Text fw={700} sx={{ fontSize: 12, whiteSpace: "nowrap" }}>
        Sector Correlation
      </Text>
      <Select
        size="small"
        value={currentMarket}
        onChange={(e) => handleMarketChange(String(e.target.value))}
        data-testid="market-segment"
        sx={{ height: 24, fontSize: 11, minWidth: 84 }}
      >
        <MenuItem value="india">India</MenuItem>
        <MenuItem value="america">US</MenuItem>
      </Select>
      <Select
        size="small"
        value={String(currentLookback)}
        onChange={(e) => handleLookbackChange(String(e.target.value))}
        data-testid="lookback-segment"
        sx={{ height: 24, fontSize: 11, minWidth: 64 }}
      >
        {LOOKBACK_OPTIONS.map((o) => (
          <MenuItem key={o.value} value={String(o.value)}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
      <Box sx={{ flex: 1 }} />
      {lastUpdated && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconClock size={12} color="var(--mui-palette-text-secondary)" />
          <Typography variant="caption" sx={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}>
            {new Date(lastUpdated).toLocaleTimeString()}
          </Typography>
        </Box>
      )}
      <Box
        data-testid="sector-correlation-refresh"
        sx={{ p: 0.5, cursor: "pointer", display: "flex", alignItems: "center" }}
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
            <Chip
              size="small"
              label={`#${rank}`}
              color={rank <= 3 ? "success" : "default"}
              variant="outlined"
              sx={{ height: 16, fontSize: 9.5, "& .MuiChip-label": { px: 0.5 } }}
            />
          );
        },
      },
      {
        id: "sector",
        header: "Sector",
        accessorKey: "name",
        meta: { align: "left" },
        cell: (info) => (
          <Text sx={{ fontWeight: 600, fontSize: 10.5, whiteSpace: "nowrap" }}>{info.getValue<string>()}</Text>
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
            <Text c={val >= 0 ? "success.main" : "error.main"} sx={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
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
            <Text c={val >= 0 ? "success.main" : "error.main"} sx={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
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
            <Text c={val >= 0 ? "success.main" : "error.main"} sx={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>
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
          <Text sx={{ fontSize: 10.5, fontVariantNumeric: "tabular-nums" }}>{info.getValue<number>().toFixed(2)}</Text>
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
            <Chip
              size="small"
              label={change > 0 ? `+${change}` : String(change)}
              color={change > 0 ? "success" : change < 0 ? "error" : "default"}
              variant="outlined"
              sx={{ height: 16, fontSize: 9.5, "& .MuiChip-label": { px: 0.5 } }}
            />
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
    <Box
      data-testid="sector-correlation-loading"
      sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, flex: 1, minHeight: 200 }}
    >
      <CircularProgress size={16} />
      <Typography variant="caption">Loading sector correlation…</Typography>
    </Box>
  );
}

function ErrorState({ error }: { error: string }) {
  const handleRefresh = () => {
    void fetchCorrelationData();
  };
  return (
    <Box data-testid="sector-correlation-error" sx={{ display: "flex", alignItems: "center", gap: 1, p: 1 }}>
      <Typography variant="caption" color="error">
        {error}
      </Typography>
      <Button variant="outlined" color="error" size="small" onClick={handleRefresh} sx={{ height: 22, fontSize: 10 }}>
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
      <Box data-testid="sector-correlation-empty" sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Typography variant="caption" color="text.secondary">
          No correlation data available.
        </Typography>
      </Box>
    );
  }
  const benchmark = sectorMarket === "india" ? "NIFTY 50" : "SPY";

  return (
    <Stack spacing={0.5} sx={{ p: 0.5, width: "100%", minWidth: 0 }}>
      <CorrelationHeader currentMarket={sectorMarket} currentLookback={lookbackDays} lastUpdated={data.last_updated} />
      <Grid container spacing={0.5} sx={{ width: "100%" }}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <CompactPanel
            flush
            padded={false}
            id="sector-correlation-heatmap"
            testId="sector-correlation-heatmap"
            title={<Text sx={{ fontSize: 10, fontWeight: 700 }}>Cross-Sector Correlation</Text>}
            sx={{ minWidth: 0 }}
          >
            <Box sx={{ p: 0.5, minHeight: 280, width: "100%" }}>
              <CorrelationHeatmap matrix={data.correlation_matrix} symbols={data.sector_names} isDark={isDark} />
            </Box>
          </CompactPanel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <CompactPanel
            flush
            padded={false}
            id="sector-beta-chart"
            testId="sector-beta-chart"
            title={<Text sx={{ fontSize: 10, fontWeight: 700 }}>Sector Beta vs Benchmark</Text>}
            sx={{ minWidth: 0 }}
          >
            <Box sx={{ p: 0.5, height: 320, width: "100%", display: "flex" }}>
              <SectorBetaChart sectors={sortedSectors} benchmark={benchmark} isDark={isDark} />
            </Box>
          </CompactPanel>
        </Grid>
      </Grid>
      <CompactPanel
        flush
        padded={false}
        id="relative-strength-table"
        testId="relative-strength-table"
        title={<Text sx={{ fontSize: 10, fontWeight: 700 }}>Relative Strength Rankings</Text>}
        sx={{ minWidth: 0 }}
      >
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <RelativeStrengthTable sectors={sortedSectors} />
        </Box>
      </CompactPanel>
      <CompactPanel
        flush
        padded={false}
        id="rotation-timeline"
        testId="rotation-timeline"
        title={<Text sx={{ fontSize: 10, fontWeight: 700 }}>Sector Rotation (1-Month Rank Change)</Text>}
        sx={{ minWidth: 0 }}
      >
        <Box sx={{ p: 0.5, height: 400, width: "100%", display: "flex" }}>
          <RotationTimeline sectors={sortedSectors} isDark={isDark} />
        </Box>
      </CompactPanel>
    </Stack>
  );
}
