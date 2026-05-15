import { useMemo } from "react";
import { Box, Text } from "@mantine/core";
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
      header: "Symbol",
      accessorKey: "symbol",
      cell: (info) => <Text fw={700} size="xs">{info.getValue<string>()}</Text>,
    },
    {
      id: "metric",
      header: activeMetric.label,
      accessorFn: (row) => getMetricValue(row, metric),
      cell: (info) => {
        const val = info.getValue<number>();
        const bg = getMetricColor(val, metricMin, metricMax);
        const tc = getMetricTextColor(val, metricMin, metricMax);
        return (
          <Box fw={700} style={{ backgroundColor: bg, color: tc, padding: "1px 4px", borderRadius: 2, textAlign: "right" }}>
            {activeMetric.fmt(val)}
          </Box>
        );
      },
    },
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      cell: (info) => <Text size="xs" c="dimmed">{info.getValue<string>()}</Text>,
    },
    {
      id: "pe_ratio",
      header: "P/E",
      accessorKey: "pe_ratio",
      cell: (info) => <Text size="xs" ta="right">{info.getValue<number>()?.toFixed(1)}</Text>,
    },
    {
      id: "market_cap",
      header: "MCap",
      accessorKey: "market_cap",
      cell: (info) => <Text size="xs" ta="right">{formatMarketCap(info.getValue<number>())}</Text>,
    },
    {
      id: "price",
      header: "Price",
      accessorKey: "price",
      cell: (info) => <Text size="xs" ta="right">₹{info.getValue<number>()?.toFixed(2)}</Text>,
    },
    {
      id: "change_pct",
      header: "Chg",
      accessorKey: "change_pct",
      cell: (info) => {
        const val = info.getValue<number>();
        return (
          <Text size="xs" ta="right" c={val >= 0 ? "green" : "red"}>
            {val >= 0 ? "+" : ""}{val?.toFixed(2)}%
          </Text>
        );
      },
    },
    {
      id: "sector",
      header: "Sector",
      accessorKey: "sector",
      cell: (info) => <Text size="xs" c="dimmed">{info.getValue<string>()}</Text>,
    },
  ], [activeMetric, metric, metricMin, metricMax]);

  return (
    <TanStackTable<HeatmapStock>
      data={stocks}
      columns={columns}
      initialState={{ sorting: [{ id: metric, desc: true }] }}
      dataTestId="heatmap-list-table"
    />
  );
}
