import { useEffect, useMemo } from "react";
import { Box, Stack } from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import TableContainer from "@mui/material/TableContainer";
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
    <Card elevation={1} sx={{ width: "100%", p: 1 }}>
      <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
        <Box sx={{ minHeight: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, flexWrap: "wrap", width: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            <Select size="small" value={currentMarket} onChange={(e) => handleMarketChange(String(e.target.value))} data-testid="market-segment">
              <MenuItem value="india">India</MenuItem>
              <MenuItem value="america">US</MenuItem>
            </Select>
            <Select size="small" value={String(currentLookback)} onChange={(e) => handleLookbackChange(String(e.target.value))} data-testid="lookback-segment">
              {LOOKBACK_OPTIONS.map((o) => (<MenuItem key={o.value} value={String(o.value)}>{o.label}</MenuItem>))}
            </Select>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            {lastUpdated && (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
                <IconClock size={12} color="var(--mui-palette-text-secondary)" />
                <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{new Date(lastUpdated).toLocaleTimeString()}</Typography>
              </Box>
            )}
            <Box sx={{ p: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 1 }} onClick={handleRefresh}>
              <IconRefresh size={14} />
            </Box>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

function RelativeStrengthTable({ sectors }: { sectors: SectorCorrelationResponse["sectors"] }) {
  const columns = useMemo<ColumnDef<SectorCorrelationResponse["sectors"][number]>[]>(
    () => [
      {
        id: "rank",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Rank</Box>,
        accessorKey: "rank_current",
        meta: { align: "center" },
        cell: (info) => {
          const rank = info.getValue<number>();
          return (<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Chip size="small" label={`#${rank}`} color={rank <= 3 ? "success" : "default"} variant="outlined" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} /></Box>);
        },
      },
      {
        id: "sector",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Sector</Box>,
        accessorKey: "name",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<string>()}</Typography></Box>,
      },
      {
        id: "rs_5d",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>5D RS</Box>,
        accessorKey: "relative_strength_5d",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ color: val >= 0 ? "success.main" : "error.main", display: "flex", alignItems: "center", justifyContent: "center" }}>{formatPercentage(val / 100, 2, false)}</Typography></Box>);
        },
      },
      {
        id: "rs_1m",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>1M RS</Box>,
        accessorKey: "relative_strength_1m",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ color: val >= 0 ? "success.main" : "error.main", display: "flex", alignItems: "center", justifyContent: "center" }}>{formatPercentage(val / 100, 2, false)}</Typography></Box>);
        },
      },
      {
        id: "rs_3m",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>3M RS</Box>,
        accessorKey: "relative_strength_3m",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ color: val >= 0 ? "success.main" : "error.main", display: "flex", alignItems: "center", justifyContent: "center" }}>{formatPercentage(val / 100, 2, false)}</Typography></Box>);
        },
      },
      {
        id: "beta",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Beta</Box>,
        accessorKey: "beta_vs_index",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<number>().toFixed(2)}</Typography></Box>,
      },
      {
        id: "rank_change",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>1M Change</Box>,
        accessorKey: "rank_change_1m",
        meta: { align: "center" },
        cell: (info) => {
          const change = info.getValue<number>();
          return (<Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Chip size="small" label={change > 0 ? `+${change}` : String(change)} color={change > 0 ? "success" : change < 0 ? "error" : "default"} variant="outlined" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} /></Box>);
        },
      },
    ],
    [],
  );

  return (
    <TableContainer sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, maxHeight: 400, overflow: "auto", width: "100%" }}>
      <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
            <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
              <TanStackTable data={sectors} columns={columns} enableSorting={false} />
            </Box>
          </CardContent>
        </Card>
      </Stack>
    </TableContainer>
  );
}


function LoadingState() {
  return (
    <Card elevation={1} sx={{ width: "100%", p: 1, minHeight: 400, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, width: "100%", "&:last-child": { pb: 1 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
          <CircularProgress size={20} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading sector correlation...</Typography>
        </Box>
        <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Computing cross-sector relationships and relative strength.</Typography>
      </CardContent>
    </Card>
  );
}

function ErrorState({ error }: { error: string }) {
  const handleRefresh = () => { void fetchCorrelationData(); };
  return (
    <Card elevation={1} sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, gap: 1, width: "100%", "&:last-child": { pb: 1 } }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
          <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Error</Typography>
        </Box>
        <Typography variant="body2" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{error}</Typography>
        <Button variant="outlined" color="error" size="small" onClick={handleRefresh} sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Retry</Button>
      </CardContent>
    </Card>
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
      <Card elevation={1} sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, "&:last-child": { pb: 1 } }}>
          <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>No data</Typography>
          <Typography variant="caption" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>No correlation data available.</Typography>
        </CardContent>
      </Card>
    );
  }
  const benchmark = sectorMarket === "india" ? "NIFTY 50" : "SPY";

  return (
    <Stack spacing={1} sx={{ p: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <CorrelationHeader currentMarket={sectorMarket} currentLookback={lookbackDays} lastUpdated={data.last_updated} />
      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "stretch", width: "100%" }}>
        <Grid size={{ xs: 12, lg: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1, minHeight: 400, display: "flex", flexDirection: "column", alignItems: "center" }} id="sector-correlation-heatmap" data-testid="sector-correlation-heatmap">
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Cross-Sector Correlation</Typography>
              </Box>
              <Box sx={{ p: 1, minHeight: 300, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <CorrelationHeatmap matrix={data.correlation_matrix} symbols={data.sector_names} isDark={isDark} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Card elevation={1} sx={{ width: "100%", p: 1, minHeight: 450, display: "flex", flexDirection: "column", alignItems: "center" }} id="sector-beta-chart" data-testid="sector-beta-chart">
            <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, "&:last-child": { pb: 1 } }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
                <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Sector Beta vs Benchmark</Typography>
              </Box>
              <Box sx={{ p: 1, height: 350, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <SectorBetaChart sectors={sortedSectors} benchmark={benchmark} isDark={isDark} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <Card elevation={1} sx={{ width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center" }} id="relative-strength-table" data-testid="relative-strength-table">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Relative Strength Rankings</Typography>
          </Box>
          <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
            <RelativeStrengthTable sectors={sortedSectors} />
          </Box>
        </CardContent>
      </Card>
      <Card elevation={1} sx={{ width: "100%", p: 1, minHeight: 500, display: "flex", flexDirection: "column", alignItems: "center" }} id="rotation-timeline" data-testid="rotation-timeline">
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", flex: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="h6" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Sector Rotation (1-Month Rank Change)</Typography>
          </Box>
          <Box sx={{ p: 1, height: 450, width: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <RotationTimeline sectors={sortedSectors} isDark={isDark} />
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
