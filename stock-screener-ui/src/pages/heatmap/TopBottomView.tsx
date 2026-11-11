import { useMemo } from "react";
import { Box, Stack, Text, Chip } from "@/ui";
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
      { id: "rank", header: () => <Box className="flex items-center justify-end">#</Box>, accessorKey: "rank", meta: { align: "right" }, cell: (info) => <Box className="flex items-center justify-end"><Text size="xs">{info.getValue<number>()}</Text></Box> },
      {
        id: "symbol",
        header: () => <Box className="flex items-center justify-start">Symbol</Box>,
        accessorKey: "symbol",
        meta: { align: "left" },
        cell: (info) => <Box className="flex items-center justify-start"><Text size="xs" fw={600}>{info.getValue<string>()}</Text></Box>,
      },
      {
        id: "name",
        header: () => <Box className="flex items-center justify-start">Name</Box>,
        accessorKey: "name",
        meta: { align: "left" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box className="flex items-center justify-start"><Text size="xs" className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 160 }}>{val}</Text></Box>
          );
        },
      },
      {
        id: "metric",
        header: () => <Box className="flex items-center justify-end">{metricConfig?.label ?? metric}</Box>,
        accessorFn: (row: any) => getMetricValue(row, metric),
        meta: { align: "right" },
        cell: (info) => {
          const val = info.getValue<number>();
          const bg = getMetricColor(val, minAll, maxAll);
          const tc = getMetricTextColor(val, minAll, maxAll);
          return (
            <Box className="flex items-center justify-end">
              <Box className="flex items-center justify-center px-1 rounded font-bold text-[11px]" style={{ backgroundColor: bg, color: tc }}>
                {fmt(val)}
              </Box>
            </Box>
          );
        },
      },
      {
        id: "pe",
        header: () => <Box className="flex items-center justify-end">P/E</Box>,
        accessorKey: "pe_ratio",
        meta: { align: "right" },
        cell: (info) => <Box className="flex items-center justify-end"><Text size="xs">{formatPe(info.getValue<number | null>())}</Text></Box>,
      },
      {
        id: "sector",
        header: () => <Box className="flex items-center justify-start">Sector</Box>,
        accessorKey: "sector",
        meta: { align: "left" },
        cell: (info) => {
          const val = info.getValue<string>();
          return (
            <Box className="flex items-center justify-start"><Text size="xs" className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ maxWidth: 120 }}>{val}</Text></Box>
          );
        },
      },
    ],
    [metric, metricConfig, fmt, minAll, maxAll],
  );

  function renderTable(title: string, badgeColor: string, data: any[], startRank: number) {
    const tableData = data.map((s, i) => ({ ...s, rank: startRank + i }));

    return (
      <Box className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border border-fin-border rounded-md">
        <Box className="flex items-center gap-2 px-1.5 h-10 flex-shrink-0 border-b border-fin-border">
          <Text size="sm" fw={600}>{title}</Text>
          <Chip size="sm" variant="outline" color={badgeColor as any}>{String(data.length)}</Chip>
        </Box>
        <Box className="flex-1 min-h-0 overflow-auto">
          <Stack spacing={0} className="w-full">
            <TanStackTable data={tableData} columns={columns} enableSorting={false} stickyHeader={false} />
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <Box className="flex gap-2 p-2 flex-1 min-h-0 w-full overflow-hidden flex-wrap">
      {renderTable("Top 10", "success", top10, 1)}
      {renderTable("Bottom 10", "error", bottom10, stocks.length - bottom10.length + 1)}
    </Box>
  );
}
