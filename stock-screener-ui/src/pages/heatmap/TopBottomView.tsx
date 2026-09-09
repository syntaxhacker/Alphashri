import { useMemo } from "react";
import { Box, Stack } from "@/ui";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import TableContainer from "@mui/material/TableContainer";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../../components/common/TanStackTable";

interface TopBottomViewProps {
  stocks: any[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  getMetricTextColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function TopBottomView({ stocks, metric, getMetricValue, getMetricColor, getMetricTextColor, METRICS }: TopBottomViewProps) {
  const metricConfig = METRICS.find((m) => m.value === metric) || METRICS[0];
  const fmt = metricConfig?.fmt ?? ((v: number) => v.toFixed(2));

  const metricValues = stocks.map((s) => getMetricValue(s, metric));
  const minAll = metricValues.length ? Math.min(...metricValues) : 0;
  const maxAll = metricValues.length ? Math.max(...metricValues) : 1;

  const top10 = stocks.slice(0, 10);
  const bottom10 = [...stocks].slice(-10).reverse();

  function formatPe(pe: number | null | undefined): string {
    if (pe == null || pe === 0) return "-";
    return pe.toFixed(1);
  }

  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      { id: "rank", header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>#</Box>, accessorKey: "rank", meta: { align: "center" }, cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<number>()}</Typography></Box> },
      {
        id: "symbol",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Symbol</Box>,
        accessorKey: "symbol",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontWeight: 500, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<string>()}</Typography></Box>,
      },
      {
        id: "name",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Name</Box>,
        accessorKey: "name",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{val}</Typography></Box>
          );
        },
      },
      {
        id: "metric",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>{metricConfig?.label ?? metric}</Box>,
        accessorFn: (row: any) => getMetricValue(row, metric),
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<number>();
          const bg = getMetricColor(val, minAll, maxAll);
          const tc = getMetricTextColor(val, minAll, maxAll);
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>
              <Box sx={{ backgroundColor: bg, color: tc, fontWeight: 700, p: 1, borderRadius: 1, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {fmt(val)}
              </Box>
            </Box>
          );
        },
      },
      {
        id: "pe",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>P/E</Box>,
        accessorKey: "pe_ratio",
        meta: { align: "center" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>{formatPe(info.getValue<number | null>())}</Typography></Box>
        ),
      },
      {
        id: "sector",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}>Sector</Box>,
        accessorKey: "sector",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1 }}><Typography sx={{ fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{val}</Typography></Box>
          );
        },
      },
    ],
    [metric, metricConfig, fmt, minAll, maxAll],
  );

  function renderTable(title: string, badgeColor: string, data: any[], startRank: number) {
    const tableData = data.map((s, i) => ({ ...s, rank: startRank + i }));

    return (
      <Card elevation={1} sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, p: 1, alignItems: "center", width: "100%" }}>
        <CardContent sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%", gap: 1, "&:last-child": { pb: 1 } }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{title}</Typography>
            <Chip size="small" label={String(data.length)} color={badgeColor as any} variant="outlined" sx={{ display: "flex", alignItems: "center", justifyContent: "center" }} />
          </Box>
          <TableContainer sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", p: 1, width: "100%" }}>
            <Stack spacing={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
              <Box sx={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
                <TanStackTable data={tableData} columns={columns} enableSorting={false} stickyHeader={false} />
              </Box>
            </Stack>
          </TableContainer>
        </CardContent>
      </Card>
    );
  }

  return (
    <Grid container spacing={1} sx={{ display: "flex", gap: 1, p: 1, flex: 1, alignItems: "center", justifyContent: "center", width: "100%" }}>
      <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
        {renderTable("Top 10", "success", top10, 1)}
      </Grid>
      <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
        {renderTable("Bottom 10", "error", bottom10, stocks.length - bottom10.length + 1)}
      </Grid>
    </Grid>
  );
}
