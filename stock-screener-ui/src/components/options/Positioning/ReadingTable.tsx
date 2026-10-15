import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
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
  value: ReactNode;
  note: string;
}

function net(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function SplitValue({ data }: { data: PositioningData }) {
  const bearish = Math.abs(data.split.bearish_cr ?? 0);
  const bullish = Math.abs(data.split.bullish_cr ?? 0);
  const gross = bearish + bullish;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 160 }}>
      <Box sx={{ display: "flex", width: "100%", height: 8, borderRadius: 1, overflow: "hidden" }}>
        <Box sx={{ width: `${data.split.bearish_pct}%`, bgcolor: NEGATIVE }} />
        <Box sx={{ width: `${data.split.bullish_pct}%`, bgcolor: POSITIVE }} />
      </Box>
      <Text size="xs" ta="right" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCr(gross)} · 100%
      </Text>
    </Box>
  );
}

const columns: ColumnDef<ReadingRow>[] = [
  { header: "Metric", accessorKey: "metric", meta: { align: "left" } },
  {
    header: "Value",
    accessorKey: "value",
    meta: { align: "right" },
    cell: ({ getValue }) => <>{getValue<ReactNode>()}</>,
  },
  {
    header: "Note",
    accessorKey: "note",
    meta: { align: "left" },
    cell: ({ getValue }) => (
      <Text size="sm" c="dimmed">
        {String(getValue<string>())}
      </Text>
    ),
  },
];

export function ReadingTable({ data }: ReadingTableProps) {
  const rows: ReadingRow[] = useMemo(
    () => [
      {
        id: "state",
        metric: "State",
        value: formatCr(net(data.state.calls_cr, data.state.puts_cr)),
        note: data.state.note,
      },
      {
        id: "flow",
        metric: "Flow",
        value: formatCr(net(data.flow.calls_cr, data.flow.puts_cr)),
        note: data.flow.note,
      },
      {
        id: "initiated",
        metric: "Initiated",
        value: formatCr(data.initiated_cr),
        note: data.initiated.note,
      },
      {
        id: "split",
        metric: "Split",
        value: <SplitValue data={data} />,
        note: `Bearish ${formatCr(data.split.bearish_cr)} · Bullish ${formatCr(data.split.bullish_cr)}`,
      },
      {
        id: "read",
        metric: "Read",
        value: formatPct(data.read.pct),
        note: `${formatShares(data.read.readable_shares)} of ${formatShares(data.read.total_shares)} shares readable`,
      },
    ],
    [data],
  );

  return (
    <TanStackTable<ReadingRow>
      data={rows}
      columns={columns}
      bare
      enableSorting={false}
      dataTestId="positioning-reading"
      getRowTestId={(row) => `positioning-reading-${row.id}`}
    />
  );
}
