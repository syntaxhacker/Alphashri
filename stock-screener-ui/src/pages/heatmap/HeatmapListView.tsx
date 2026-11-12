import { createMemo } from "solid-js";
import { Box, Text } from "@/ui";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import { TanStackTable } from "../../components/common/TanStackTable";
import type { HeatmapStock } from "../../api/heatmap";
import { getMetricValue, getMetricColor, getMetricTextColor, formatMarketCap } from "./heatmapUtils";
import type { MetricConfig } from "./heatmapUtils";

const MONO = "font-mono tabular-nums";

interface Props {
  stocks: HeatmapStock[];
  metric: string;
  activeMetric: MetricConfig;
  metricMin: number;
  metricMax: number;
}

export function HeatmapListView(props: Props) {
  const columns = createMemo<TableColumnDef<HeatmapStock>[]>(() => [
    {
      id: "symbol",
      header: () => <Box className="flex items-center justify-start gap-2 p-2">Symbol</Box>,
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start gap-2 p-2">
          <Text className="font-bold text-[12px] flex items-center justify-start">{row.original.symbol}</Text>
        </Box>
      ),
    },
    {
      id: "metric",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">{props.activeMetric.label}</Box>,
      accessorFn: (row) => getMetricValue(row, props.metric),
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = getMetricValue(row.original, props.metric);
        const bg = getMetricColor(val, props.metricMin, props.metricMax);
        const tc = getMetricTextColor(val, props.metricMin, props.metricMax);
        return (
          <Box className="flex items-center justify-end gap-2 p-2">
            <Box className={`flex items-center justify-center px-2 rounded font-bold text-[12px] ${MONO}`} style={{ backgroundColor: bg, color: tc }}>
              {props.activeMetric.fmt(val)}
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
      cell: ({ row }) => (
        <Box className="flex items-center justify-start gap-2 p-2">
          <Text className="text-[12px] flex items-center justify-start">{row.original.name}</Text>
        </Box>
      ),
    },
    {
      id: "pe_ratio",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">P/E</Box>,
      accessorKey: "pe_ratio",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-end gap-2 p-2">
          <Text className={`text-[12px] flex items-center justify-end ${MONO}`}>{row.original.pe_ratio?.toFixed(1)}</Text>
        </Box>
      ),
    },
    {
      id: "market_cap",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">MCap</Box>,
      accessorKey: "market_cap",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-end gap-2 p-2">
          <Text className={`text-[12px] flex items-center justify-end ${MONO}`}>{formatMarketCap(row.original.market_cap)}</Text>
        </Box>
      ),
    },
    {
      id: "price",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">Price</Box>,
      accessorKey: "price",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-end gap-2 p-2">
          <Text className={`text-[12px] flex items-center justify-end ${MONO}`}>₹{row.original.price?.toFixed(2)}</Text>
        </Box>
      ),
    },
    {
      id: "change_pct",
      header: () => <Box className="flex items-center justify-end gap-2 p-2">Chg</Box>,
      accessorKey: "change_pct",
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = row.original.change_pct;
        return (
          <Box className="flex items-center justify-end gap-2 p-2">
            <Text className={`text-[12px] flex items-center justify-end ${MONO} ${val >= 0 ? "text-fin-positive" : "text-fin-negative"}`}>
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
      cell: ({ row }) => (
        <Box className="flex items-center justify-start gap-2 p-2">
          <Text className="text-[12px] flex items-center justify-start">{row.original.sector}</Text>
        </Box>
      ),
    },
  ]);

  return (
    <Box className="flex-1 min-h-0 overflow-auto w-full">
      <TanStackTable<HeatmapStock>
        data={props.stocks}
        columns={columns()}
        initialState={{ sorting: [{ id: props.metric, desc: true }] }}
        dataTestId="heatmap-list-table"
      />
    </Box>
  );
}
