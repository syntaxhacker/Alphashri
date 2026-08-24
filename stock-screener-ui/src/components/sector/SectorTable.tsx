import { useMemo } from "react";
import { Text, Badge, Progress, Box, Stack } from "@/ui";
import TableContainer from "@mui/material/TableContainer";
import CardContent from "@mui/material/CardContent";
import type { ColumnDef } from "@tanstack/react-table";
import type { SectorItem } from "../../types/sector";
import { TanStackTable } from "../common/TanStackTable";
import { getPnLTextColor } from "../../utils/ui-helpers";

interface SectorTableProps {
  sectors: SectorItem[];
}

export function getMovementBarValue(pctChange: number): { capped: number; color: string } {
  const normalized = (pctChange + 3) / 6;
  const capped = Math.max(0, Math.min(1, normalized)) * 100;
  const color = getPnLTextColor(pctChange);
  return { capped, color };
}

export function getStrengthInfo(avgAdx: number): { label: string; color: string } {
  if (avgAdx > 25) return { label: "Strong", color: "green" };
  if (avgAdx < 15) return { label: "Weak", color: "red" };
  return { label: "Neutral", color: "gray" };
}

function getMovementBar(pctChange: number) {
  const { capped, color } = getMovementBarValue(pctChange);

  return (
    <Box sx={{ width: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Progress value={capped} color={color} size="sm" radius="xl" />
    </Box>
  );
}

export function SectorTable({ sectors }: SectorTableProps) {
  const columns = useMemo<ColumnDef<SectorItem>[]>(
    () => [
      {
        id: "sector",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Sector</Box>,
        accessorKey: "sector",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{info.getValue<string>()}</Box>,
      },
      {
        id: "avg_change",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Change</Box>,
        accessorKey: "avg_change",
        meta: { align: "center" },
        cell: (info) => {
          const val = info.getValue<number>();
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", color: getPnLTextColor(val), fontWeight: 700, fontSize: 12 }}>
              {val >= 0 ? "+" : ""}
              {val.toFixed(2)}%
            </Box>
          );
        },
      },
      {
        id: "movement",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Movement</Box>,
        accessorKey: "avg_change",
        meta: { align: "center" },
        cell: (info) => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{getMovementBar(info.getValue<number>())}</Box>,
      },
      {
        id: "ad_ratio",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>A/D Ratio</Box>,
        accessorFn: (row) => `${row.advances} : ${row.declines}`,
        meta: { align: "center" },
        cell: (info) => {
          const row = info.row.original;
          const adColor = row.advances > row.declines ? "green" : "red";
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", color: adColor, fontSize: 12, fontWeight: 600 }}>
              {row.advances} : {row.declines}
            </Box>
          );
        },
      },
      {
        id: "strength",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Strength</Box>,
        accessorKey: "avg_adx",
        meta: { align: "center" },
        cell: (info) => {
          const { label, color } = getStrengthInfo(info.getValue<number>());
          return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Badge color={color} variant="light" size="sm">
                {label}
              </Badge>
            </Box>
          );
        },
      },
      {
        id: "top_movers",
        header: () => <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>Top Movers</Box>,
        accessorKey: "top_movers",
        meta: { align: "center" },
        cell: (info) => (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {info.getValue<string>()}
            </Text>
          </Box>
        ),
      },
    ],
    [],
  );

  return (
    <TableContainer sx={{ display: "flex", flexDirection: "column", alignItems: "center", p: 1 }}>
      <Stack gap={1} sx={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
        <CardContent sx={{ p: 1, width: "100%", "&:last-child": { pb: 1 } }}>
          <TanStackTable<SectorItem>
            data={sectors}
            columns={columns}
            enableSorting={false}
            emptyMessage="No sector data available"
            dataTestId="sector-table"
            getRowTestId={(sector) => `sector-row-${sector.sector.toLowerCase()}`}
          />
        </CardContent>
      </Stack>
    </TableContainer>
  );
}
