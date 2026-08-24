import { useMemo } from "react";
import { Text, Box, Stack } from "@/ui";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";
import type { ColumnDef } from "@tanstack/react-table";
import type { InternalStockMover } from "./sectorUtils";
import { getPnLTextColor } from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";

export function IntervalMoversTable({ movers }: { movers: InternalStockMover[] }) {
  const columns = useMemo<ColumnDef<InternalStockMover>[]>(
    () => [
      {
        id: "symbol",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Stock</Box>,
        accessorKey: "symbol",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}><Text fw={600}>{info.getValue<string>()}</Text></Box>,
      },
      {
        id: "prev",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Prev</Box>,
        accessorKey: "prev_change",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<number>().toFixed(2)}%</Box>,
      },
      {
        id: "change",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Now</Box>,
        accessorKey: "change",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{info.getValue<number>().toFixed(2)}%</Box>,
      },
      {
        id: "delta",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Δ</Box>,
        accessorKey: "delta",
        meta: { align: "center" },
        cell: (info) => {
          const delta = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text c={getPnLTextColor(delta)} fw={700}>
                {delta > 0 ? "+" : ""}
                {delta.toFixed(2)}%
              </Text>
            </Box>
          );
        },
      },
    ],
    [],
  );

  if (movers.length === 0) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 1 }}>
        <Text size="sm" c="dimmed" ta="center" py="xl">
          Collecting baseline for interval moves...
        </Text>
      </Box>
    );
  }

  return (
    <TableContainer sx={{ p: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Stack gap={1} sx={{ width: "100%", alignItems: "center" }}>
        <CardContent sx={{ p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <TanStackTable<InternalStockMover>
            data={movers}
            columns={columns}
            enableSorting={false}
            dataTestId="interval-movers-table"
          />
        </CardContent>
      </Stack>
    </TableContainer>
  );
}
