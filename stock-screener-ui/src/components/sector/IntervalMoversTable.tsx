import { useMemo } from "react";
import { Text } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";

export function IntervalMoversTable({ movers }: { movers: InternalStockMover[] }) {
  const columns = useMemo<ColumnDef<InternalStockMover>[]>(
    () => [
      {
        id: "symbol",
        header: "Stock",
        accessorKey: "symbol",
        cell: (info) => <Text fw={600}>{info.getValue<string>()}</Text>,
      },
      {
        id: "prev",
        header: "Prev",
        accessorKey: "prev_change",
        meta: { align: "right" },
        cell: (info) => <>{info.getValue<number>().toFixed(2)}%</>,
      },
      {
        id: "change",
        header: "Now",
        accessorKey: "change",
        meta: { align: "right" },
        cell: (info) => <>{info.getValue<number>().toFixed(2)}%</>,
      },
      {
        id: "delta",
        header: "Δ",
        accessorKey: "delta",
        meta: { align: "right" },
        cell: (info) => {
          const delta = info.getValue<number>();
          return (
            <Text c={getPnLTextColor(delta)} fw={700}>
              {delta > 0 ? "+" : ""}
              {delta.toFixed(2)}%
            </Text>
          );
        },
      },
    ],
    [],
  );

  if (movers.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        Collecting baseline for interval moves...
      </Text>
    );
  }

  return (
    <TanStackTable<InternalStockMover>
      data={movers}
      columns={columns}
      enableSorting={false}
      dataTestId="interval-movers-table"
    />
  );
}
