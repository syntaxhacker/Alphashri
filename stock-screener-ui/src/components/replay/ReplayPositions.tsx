import { Text, Badge, Group, Box } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { TanStackTable } from "../common/TanStackTable";
import { SideBadge } from "../common/BadgeComponents";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ReplayOpenPosition } from "../../types/replay";

interface ReplayPositionsProps {
  positions: ReplayOpenPosition[];
}

export function ReplayPositions({ positions }: ReplayPositionsProps) {
  if (positions.length === 0) return null;

  const columns: ColumnDef<ReplayOpenPosition>[] = [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      cell: ({ row }) => <Text size="xs" ta="center">{row.original.quantity}</Text>,
    },
    {
      id: "entry_price",
      header: "Entry Price",
      accessorKey: "entry_price",
      cell: ({ row }) => <Text size="xs" ta="right">{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "sl",
      header: "SL",
      accessorKey: "sl",
      cell: ({ row }) => <Text size="xs" ta="right" c="error">{row.original.sl.toFixed(2)}</Text>,
    },
    {
      id: "tp",
      header: "TP",
      accessorKey: "tp",
      cell: ({ row }) => <Text size="xs" ta="right" c="success">{row.original.tp.toFixed(2)}</Text>,
    },
    {
      id: "strategy",
      header: "Strategy",
      accessorKey: "strategy",
      cell: ({ row }) => <Text size="xs">{row.original.strategy}</Text>,
    },
    {
      id: "entry_time",
      header: "Entry Time",
      accessorKey: "entry_time",
      cell: ({ row }) => <Text size="xs">{formatTimeOnly(row.original.entry_time)}</Text>,
    },
  ];

  return (
    <Box data-testid="replay-positions">
      <Group gap="sm" mb={2}>
        <Text size="xs" fw={500}>Open Positions</Text>
        <Badge variant="light" color="primary" size="xs">{positions.length}</Badge>
      </Group>
      <TanStackTable<ReplayOpenPosition>
        data={positions}
        columns={columns}
        dataTestId="replay-positions-table"
        emptyMessage="No open positions"
      />
    </Box>
  );
}
