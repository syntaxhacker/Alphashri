import { Show } from "solid-js";
import { Text, Badge } from "@/ui";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import { TanStackTable } from "../paper-trading/TanStackTable";
import { SideBadge } from "../common/BadgeComponents";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ReplayOpenPosition } from "../../types/replay";
import { Group, Box } from "../paper-trading/primitives";

interface ReplayPositionsProps {
  positions: ReplayOpenPosition[];
}

export function ReplayPositions(props: ReplayPositionsProps) {
  const columns: TableColumnDef<ReplayOpenPosition>[] = [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" },
      cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="center" className="font-mono tabular-nums">{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry Price",
      accessorKey: "entry_price",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="right" className="font-mono tabular-nums">{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "sl",
      header: "SL",
      accessorKey: "sl",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="right" c="error" className="font-mono tabular-nums">{row.original.sl.toFixed(2)}</Text>,
    },
    {
      id: "tp",
      header: "TP",
      accessorKey: "tp",
      meta: { align: "right" },
      cell: ({ row }) => <Text size="xs" ta="right" c="success" className="font-mono tabular-nums">{row.original.tp.toFixed(2)}</Text>,
    },
    {
      id: "strategy",
      header: "Strategy",
      accessorKey: "strategy",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs">{row.original.strategy}</Text>,
    },
    {
      id: "entry_time",
      header: "Entry Time",
      accessorKey: "entry_time",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" className="font-mono tabular-nums">{formatTimeOnly(row.original.entry_time)}</Text>,
    },
  ];

  return (
    <Show when={props.positions.length > 0}>
      <Box data-testid="replay-positions">
        <Group gap="xs" align="center" mb={0.5}>
          <Text size="xs" fw={500}>Open Positions</Text>
          <Badge variant="light" color="primary" size="xs">{props.positions.length}</Badge>
        </Group>
        <TanStackTable<ReplayOpenPosition>
          data={props.positions}
          columns={columns}
          dataTestId="replay-positions-table"
          emptyMessage="No open positions"
          stickyHeader
          dense
        />
      </Box>
    </Show>
  );
}
