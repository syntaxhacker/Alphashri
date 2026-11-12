import { createMemo, type JSX } from "solid-js";
import type { TableColumnDef } from "../../common/TanStackTable";
import { Box, Text } from "@/ui";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import { TanStackTable } from "../../common/TanStackTable";
import {
  formatCr,
  formatPct,
  formatShares,
  type PositioningData,
} from "@/utils/positioning";

interface ReadingTableProps {
  data: PositioningData;
}

interface ReadingRow {
  id: "state" | "flow" | "initiated" | "split" | "read";
  metric: string;
  value: JSX.Element;
  note: string;
}

function net(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function SplitValue(props: { data: PositioningData }) {
  const bearish = Math.abs(props.data.split.bearish_cr ?? 0);
  const bullish = Math.abs(props.data.split.bullish_cr ?? 0);
  const gross = bearish + bullish;
  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: "160px" }}>
      <Box style={{ display: "flex", width: "100%", height: "8px", borderRadius: "1px", overflow: "hidden" }}>
        <Box style={{ width: `${props.data.split.bearish_pct}%`, backgroundColor: NEGATIVE }} />
        <Box style={{ width: `${props.data.split.bullish_pct}%`, backgroundColor: POSITIVE }} />
      </Box>
      <Text size="xs" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCr(gross)} · 100%
      </Text>
    </Box>
  );
}

const columns: TableColumnDef<ReadingRow>[] = [
  { id: "metric", header: "Metric", accessorKey: "metric", meta: { align: "left" } },
  {
    id: "value",
    header: "Value",
    accessorKey: "value",
    meta: { align: "right" },
    cell: (ctx) => <>{ctx.row.original.value}</>,
  },
  {
    id: "note",
    header: "Note",
    accessorKey: "note",
    meta: { align: "left" },
    cell: (ctx) => (
      <Text size="sm" c="dimmed">
        {ctx.row.original.note}
      </Text>
    ),
  },
];

export function ReadingTable(props: ReadingTableProps) {
  const rows = createMemo<ReadingRow[]>(() => [
    {
      id: "state",
      metric: "State",
      value: formatCr(net(props.data.state.calls_cr, props.data.state.puts_cr)),
      note: props.data.state.note,
    },
    {
      id: "flow",
      metric: "Flow",
      value: formatCr(net(props.data.flow.calls_cr, props.data.flow.puts_cr)),
      note: props.data.flow.note,
    },
    {
      id: "initiated",
      metric: "Initiated",
      value: formatCr(props.data.initiated_cr),
      note: props.data.initiated.note,
    },
    {
      id: "split",
      metric: "Split",
      value: <SplitValue data={props.data} />,
      note: `Bearish ${formatCr(props.data.split.bearish_cr)} · Bullish ${formatCr(props.data.split.bullish_cr)}`,
    },
    {
      id: "read",
      metric: "Read",
      value: formatPct(props.data.read.pct),
      note: `${formatShares(props.data.read.readable_shares)} of ${formatShares(props.data.read.total_shares)} shares readable`,
    },
  ]);

  return (
    <TanStackTable<ReadingRow>
      data={rows()}
      columns={columns}
      bare
      enableSorting={false}
      dataTestId="positioning-reading"
      getRowTestId={(row) => `positioning-reading-${row.id}`}
    />
  );
}
