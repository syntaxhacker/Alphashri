import { useMemo } from "react";
import TableContainer from "@mui/material/TableContainer";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { Box, Stack } from "@/ui";
import Typography from "@mui/material/Typography";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { HeatmapStock } from "../../api/heatmap";
import { getMetricValue, getMetricColor, getMetricTextColor, formatMarketCap } from "./heatmapUtils";
import type { MetricConfig } from "./heatmapUtils";

interface Props {
  stocks: HeatmapStock[];
  metric: string;
  activeMetric: MetricConfig;
  metricMin: number;
  metricMax: number;
}

export function HeatmapListView({ stocks, metric, activeMetric, metricMin, metricMax }: Props) {
  const columns = useMemo<ColumnDef<HeatmapStock>[]>(() => [
    {
      id: "symbol",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Symbol</Box>,
      accessorKey: "symbol",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<string>()}</Typography></Box>,
    },
    {
      id: "metric",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>{activeMetric.label}</Box>,
      accessorFn: (row) => getMetricValue(row, metric),
      meta: { align: "center" },
      cell: (info) => {
        const val = info.getValue<number>();
        const bg = getMetricColor(val, metricMin, metricMax);
        const tc = getMetricTextColor(val, metricMin, metricMax);
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            <Box sx={{ backgroundColor: bg, color: tc, p: 1, borderRadius: 1, fontWeight: 700, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {activeMetric.fmt(val)}
            </Box>
          </Box>
        );
      },
    },
    {
      id: "name",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Name</Box>,
      accessorKey: "name",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<string>()}</Typography></Box>,
    },
    {
      id: "pe_ratio",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>P/E</Box>,
      accessorKey: "pe_ratio",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<number>()?.toFixed(1)}</Typography></Box>,
    },
    {
      id: "market_cap",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>MCap</Box>,
      accessorKey: "market_cap",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{formatMarketCap(info.getValue<number>())}</Typography></Box>,
    },
    {
      id: "price",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Price</Box>,
      accessorKey: "price",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>₹{info.getValue<number>()?.toFixed(2)}</Typography></Box>,
    },
    {
      id: "change_pct",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Chg</Box>,
      accessorKey: "change_pct",
      meta: { align: "center" },
      cell: (info) => {
        const val = info.getValue<number>();
        return (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
            <Typography sx={{ fontSize: 12, color: val >= 0 ? "success.main" : "error.main", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {val >= 0 ? "+" : ""}{val?.toFixed(2)}%
            </Typography>
          </Box>
        );
      },
    },
    {
      id: "sector",
      header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Sector</Box>,
      accessorKey: "sector",
      meta: { align: "center" },
      cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<string>()}</Typography></Box>,
    },
  ], [activeMetric, metric, metricMin, metricMax]);

  return (
    <TableContainer sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1 }}>
      <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
        <Card elevation={1} sx={{ width: "100%", p: 1 }}>
          <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
            <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
              <TanStackTable<HeatmapStock>
                data={stocks}
                columns={columns}
                initialState={{ sorting: [{ id: metric, desc: true }] }}
                dataTestId="heatmap-list-table"
              />
            </Box>
          </CardContent>
        </Card>
      </Stack>
    </TableContainer>
  );
}
