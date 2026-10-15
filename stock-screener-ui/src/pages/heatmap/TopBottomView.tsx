import { useMemo } from "react";
import { Box, Stack, Text } from "@/ui";
import Chip from "@mui/material/Chip";
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
      { id: "rank", header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>#</Box>, accessorKey: "rank", meta: { align: "right" }, cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="xs">{info.getValue<number>()}</Text></Box> },
      {
        id: "symbol",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>Symbol</Box>,
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text size="xs" fw={600}>{info.getValue<string>()}</Text></Box>,
      },
      {
        id: "name",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>Name</Box>,
        accessorKey: "name",
        meta: { align: "left" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text size="xs" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{val}</Text></Box>
          );
        },
      },
      {
        id: "metric",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{metricConfig?.label ?? metric}</Box>,
        accessorFn: (row: any) => getMetricValue(row, metric),
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          const bg = getMetricColor(val, minAll, maxAll);
          const tc = getMetricTextColor(val, minAll, maxAll);
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
              <Box sx={{ backgroundColor: bg, color: tc, fontWeight: 700, p: 0.5, borderRadius: 1, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {fmt(val)}
              </Box>
            </Box>
          );
        },
      },
      {
        id: "pe",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>P/E</Box>,
        accessorKey: "pe_ratio",
        meta: { align: "right" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}><Text size="xs">{formatPe(info.getValue<number | null>())}</Text></Box>
        ),
      },
      {
        id: "sector",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}>Sector</Box>,
        accessorKey: "sector",
        meta: { align: "left" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-start" }}><Text size="xs" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{val}</Text></Box>
          );
        },
      },
    ],
    [metric, metricConfig, fmt, minAll, maxAll],
  );

  function renderTable(title: string, badgeColor: string, data: any[], startRank: number) {
    const tableData = data.map((s, i) => ({ ...s, rank: startRank + i }));

    return (
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--mui-palette-divider)", borderRadius: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, height: 40, flexShrink: 0, borderBottom: "1px solid var(--mui-palette-divider)" }}>
          <Text size="sm" fw={600}>{title}</Text>
          <Chip size="small" label={String(data.length)} color={badgeColor as any} variant="outlined" />
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <Stack spacing={0} sx={{ width: "100%" }}>
            <TanStackTable data={tableData} columns={columns} enableSorting={false} stickyHeader={false} />
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", gap: 1, p: 1, flex: 1, minHeight: 0, width: "100%", overflow: "hidden", flexWrap: "wrap" }}>
      {renderTable("Top 10", "success", top10, 1)}
      {renderTable("Bottom 10", "error", bottom10, stocks.length - bottom10.length + 1)}
    </Box>
  );
}
