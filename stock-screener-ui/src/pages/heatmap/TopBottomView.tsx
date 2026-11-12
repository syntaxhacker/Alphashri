import { createMemo, For } from "solid-js";
import { Box, Stack, Text, Chip } from "@/ui";
import type { TableColumnDef } from "../../components/common/TanStackTable";
import { TanStackTable } from "../../components/common/TanStackTable";

const MONO = "font-mono tabular-nums";

interface TopBottomViewProps {
  stocks: any[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  getMetricTextColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function TopBottomView(props: TopBottomViewProps) {
  const metricConfig = () => props.METRICS.find((m) => m.value === props.metric) || props.METRICS[0];
  const fmt = () => metricConfig()?.fmt ?? ((v: number) => v.toFixed(2));

  const metricValues = () => props.stocks.map((s) => props.getMetricValue(s, props.metric));
  const minAll = () => (metricValues().length ? Math.min(...metricValues()) : 0);
  const maxAll = () => (metricValues().length ? Math.max(...metricValues()) : 1);

  const top10 = () => props.stocks.slice(0, 10);
  const bottom10 = () => [...props.stocks].slice(-10).reverse();

  function formatPe(pe: number | null | undefined): string {
    if (pe == null || pe === 0) return "-";
    return pe.toFixed(1);
  }

  const columns = createMemo<TableColumnDef<any>[]>(() => [
    {
      id: "rank",
      header: () => <Box className="flex items-center justify-end">#</Box>,
      accessorKey: "rank",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-end"><Text size="xs" class={MONO}>{row.original.rank}</Text></Box>
      ),
    },
    {
      id: "symbol",
      header: () => <Box className="flex items-center justify-start">Symbol</Box>,
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start"><Text size="xs" fw={600}>{row.original.symbol}</Text></Box>
      ),
    },
    {
      id: "name",
      header: () => <Box className="flex items-center justify-start">Name</Box>,
      accessorKey: "name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start"><Text size="xs" className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ "max-width": 160 }}>{row.original.name}</Text></Box>
      ),
    },
    {
      id: "metric",
      header: () => <Box className="flex items-center justify-end">{metricConfig()?.label ?? props.metric}</Box>,
      accessorFn: (row: any) => props.getMetricValue(row, props.metric),
      meta: { align: "right" },
      cell: ({ row }) => {
        const val = props.getMetricValue(row.original, props.metric);
        const bg = props.getMetricColor(val, minAll(), maxAll());
        const tc = props.getMetricTextColor(val, minAll(), maxAll());
        return (
          <Box className="flex items-center justify-end">
            <Box className={`flex items-center justify-center px-1 rounded font-bold text-[11px] ${MONO}`} style={{ "background-color": bg, color: tc }}>
              {fmt()(val)}
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
      cell: ({ row }) => (
        <Box className="flex items-center justify-end"><Text size="xs" class={MONO}>{formatPe(row.original.pe_ratio)}</Text></Box>
      ),
    },
    {
      id: "sector",
      header: () => <Box className="flex items-center justify-start">Sector</Box>,
      accessorKey: "sector",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Box className="flex items-center justify-start"><Text size="xs" className="overflow-hidden text-ellipsis whitespace-nowrap" style={{ "max-width": 120 }}>{row.original.sector}</Text></Box>
      ),
    },
  ]);

  const tables = createMemo(() => [
    { title: "Top 10", badgeColor: "success", data: top10().map((s, i) => ({ ...s, rank: 1 + i })) },
    { title: "Bottom 10", badgeColor: "error", data: bottom10().map((s, i) => ({ ...s, rank: props.stocks.length - bottom10().length + 1 + i })) },
  ]);

  return (
    <Box className="flex gap-2 p-2 flex-1 min-h-0 w-full overflow-hidden flex-wrap">
      <For each={tables()}>
        {(t) => (
          <Box className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden border border-fin-border rounded-md">
            <Box className="flex items-center gap-2 px-1.5 h-10 flex-shrink-0 border-b border-fin-border">
              <Text size="sm" fw={600}>{t.title}</Text>
              <Chip size="sm" variant="outline" color={t.badgeColor as any}>{String(t.data.length)}</Chip>
            </Box>
            <Box className="flex-1 min-h-0 overflow-auto">
              <Stack spacing={0} className="w-full">
                <TanStackTable data={t.data} columns={columns()} enableSorting={false} stickyHeader={false} />
              </Stack>
            </Box>
          </Box>
        )}
      </For>
    </Box>
  );
}
