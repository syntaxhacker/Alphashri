import { useMemo } from "react";
import { Box, Text } from "@/ui";
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
      header: () => <Box className="flex items-center justify-start gap-2 p-2">Symbol</Box>,
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: (info) => <Box className="flex items-center justify-start gap-2 p-2"><Text className="font-bold text-[12px] flex items-center justify-start">{info.getValue<string>()}</Text></Box>,
    },
    {
      id: "metric",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">{activeMetric.label}</Box>,
      accessorFn: (row) => getMetricValue(row, metric),
      meta: { align: "right" },
      cell: (info) => {
        const val = info.getValue<number>();
        const bg = getMetricColor(val, metricMin, metricMax);
        const tc = getMetricTextColor(val, metricMin, metricMax);
        return (
          <Box className="flex items-center justify-end gap-2 p-2">
            <Box className="flex items-center justify-center px-2 rounded font-bold text-[12px]" style={{ backgroundColor: bg, color: tc }}>
              {activeMetric.fmt(val)}
            </Box>
          </Box>
        );
      },
    },
    {
      id: "name",
      header: () => <Box className="flex items-center justify-start gap-2 p-2">Name</Box>,
      accessorKey: "name",
      meta: { align: "left" },
      cell: (info) => <Box className="flex items-center justify-start gap-2 p-2"><Text className="text-[12px] flex items-center justify-start">{info.getValue<string>()}</Text></Box>,
    },
    {
      id: "pe_ratio",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">P/E</Box>,
      accessorKey: "pe_ratio",
      meta: { align: "right" },
      cell: (info) => <Box className="flex items-center justify-end gap-2 p-2"><Text className="text-[12px] flex items-center justify-end">{info.getValue<number>()?.toFixed(1)}</Text></Box>,
    },
    {
      id: "market_cap",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">MCap</Box>,
      accessorKey: "market_cap",
      meta: { align: "right" },
      cell: (info) => <Box className="flex items-center justify-end gap-2 p-2"><Text className="text-[12px] flex items-center justify-end">{formatMarketCap(info.getValue<number>())}</Text></Box>,
    },
    {
      id: "price",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">Price</Box>,
      accessorKey: "price",
      meta: { align: "right" },
      cell: (info) => <Box className="flex items-center justify-end gap-2 p-2"><Text className="text-[12px] flex items-center justify-end">₹{info.getValue<number>()?.toFixed(2)}</Text></Box>,
    },
    {
      id: "change_pct",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">Chg</Box>,
      accessorKey: "change_pct",
      meta: { align: "right" },
      cell: (info) => {
        const val = info.getValue<number>();
        return (
          <Box className="flex items-center justify-end gap-2 p-2">
            <Text className={`text-[12px] flex items-center justify-end ${val >= 0 ? "text-fin-positive" : "text-fin-negative"}`}>
              {val >= 0 ? "+" : ""}{val?.toFixed(2)}%
            </Text>
          </Box>
        );
      },
    },
    {
      id: "sector",
      header: () => <Box className="flex items-center justify-start gap-2 p-2">Sector</Box>,
      accessorKey: "sector",
      meta: { align: "left" },
      cell: (info) => <Box className="flex items-center justify-start gap-2 p-2"><Text className="text-[12px] flex items-center justify-start">{info.getValue<string>()}</Text></Box>,
    },
  ], [activeMetric, metric, metricMin, metricMax]);

  return (
    <Box className="flex-1 min-h-0 overflow-auto w-full">
      <TanStackTable<HeatmapStock>
        data={stocks}
        columns={columns}
        initialState={{ sorting: [{ id: metric, desc: true }] }}
        dataTestId="heatmap-list-table"
      />
    </Box>
  );
}
